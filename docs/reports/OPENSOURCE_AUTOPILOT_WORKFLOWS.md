# Open Source Autopilot Workflows

Workflows for autonomous maintenance of helgesverre's open source projects:

- **sema** (+ sema-lisp/* ecosystem: 15+ repos)
- **jake** (jakefile.dev)
- **glue** (getglue.dev)
- **sql-splitter** (sql-splitter.dev)
- **dbdump**
- **toon-php**

All have CI/CD via GitHub Actions, no manual releases.

---

## Workflow 1: **Dependabot PR Auto-Merge**

**Problem**: Dependabot creates PRs for action version bumps, but they require manual review/merge

**Workflow**:

```sema
(defworkflow dependabot-auto-merge
  {:phases ["Discover" "Validate" "Merge"]
   :budget {:usd 0.50}}

  (phase "Discover")
  ;; List all open dependabot PRs across repos
  (def repos ["helgesverre/jake" "helgesverre/glue" "helgesverre/sql-splitter" "helgesverre/dbdump" "helgesverre/toon-php"])
  (def prs
    (checkpoint :prs
      (parallel
        (map (lambda (repo)
               (lambda ()
                 (shell f"gh pr list --repo ${repo} --author app/dependabot --json number,title,url,labels")))
             repos)
        5)))

  (phase "Validate")
  ;; For each PR, check if CI passes and change is safe
  (def validations
    (checkpoint :validations
      (parallel
        (map (lambda (pr)
               (lambda ()
                 (let ((checks (shell f"gh pr checks ${(:url pr)} --json name,state")))
                   (step f"Is this dependabot PR safe to merge?
PR: ${(:title pr)}
CI Status: ${checks}
Changed Files: ${(shell f"gh pr diff ${(:url pr)} --name-only")}

Return JSON: {{\"safe\": boolean, \"reason\": \"...\"}})"
                         {:name "validate-pr"
                          :schema {:safe :boolean :reason :string}}))))
             (flatten prs))
        8)))

  (phase "Merge")
  ;; Auto-merge safe PRs
  (def merged
    (checkpoint :merged
      (map (lambda (validation pr)
             (if (:safe validation)
               (begin
                 (shell f"gh pr merge ${(:url pr)} --auto --squash")
                 {:pr (:url pr) :merged true})
               {:pr (:url pr) :merged false :reason (:reason validation)}))
           validations
           (flatten prs))))

  {:status :success
   :result {:total (length (flatten prs))
            :merged (length (filter :merged merged))
            :skipped (filter (lambda (m) (not (:merged m))) merged)}})
```

**Trigger**: Daily cron or on Dependabot PR webhook

**Value**: Eliminates ~10-20 manual PR reviews per month

---

## Workflow 2: **Feature Prioritization from Docs/Issues**

**Problem**: Features planned in `docs/plans/` or GitHub issues pile up, unclear what to build next

**Workflow**:

```sema
(defworkflow prioritize-features
  {:phases ["Gather" "Analyze" "Score" "Report"]
   :budget {:usd 2.00}}

  (phase "Gather")
  ;; Collect all sources of feature ideas
  (def repo (or (:repo *workflow-args*) "helgesverre/jake"))
  (def plans (checkpoint :plans (file/glob "docs/plans/*.md")))
  (def ideas (checkpoint :ideas (file/glob "docs/ideas/*.md")))
  (def issues
    (checkpoint :issues
      (shell f"gh issue list --repo ${repo} --label enhancement --json number,title,body,reactions")))

  (phase "Analyze")
  ;; LLM analyzes each feature idea
  (def analyses
    (checkpoint :analyses
      (parallel
        (map (lambda (source)
               (lambda ()
                 (let ((content (if (:file source) (file/read (:file source)) (:body source))))
                   (step f"Analyze this feature idea and extract:
Content: ${content}

Return JSON: {{
  \"feature\": \"one-line summary\",
  \"complexity\": \"low|medium|high\",
  \"impact\": \"low|medium|high\",
  \"dependencies\": [\"...\"],
  \"user_value\": \"why users care\"
}}"
                         {:name "analyze-feature"
                          :schema {:feature :string
                                   :complexity :string
                                   :impact :string
                                   :dependencies :list
                                   :user_value :string}}))))
             (append (map (lambda (f) {:file f :type "plan"}) plans)
                     (map (lambda (f) {:file f :type "idea"}) ideas)
                     (map (lambda (i) {:number (:number i) :body (:body i) :type "issue"})
                          (json/decode issues))))
        4)))

  (phase "Score")
  ;; Score each feature by impact/effort ratio
  (def scored
    (checkpoint :scored
      (map (lambda (analysis)
             (let ((complexity-score (cond
                                       ((= (:complexity analysis) "low") 1)
                                       ((= (:complexity analysis) "medium") 2)
                                       (true 3)))
                   (impact-score (cond
                                   ((= (:impact analysis) "low") 1)
                                   ((= (:impact analysis) "medium") 2)
                                   (true 3)))
                   (score (/ impact-score complexity-score)))
               (assoc analysis :priority-score score)))
           analyses)))

  (phase "Report")
  (def report
    (checkpoint :report
      (step f"Generate a prioritized feature roadmap markdown:

Features analyzed: ${(json/encode scored)}

Create a report with:
1. Top 5 high-priority features (high impact, low complexity)
2. Quick wins (low complexity, any impact)
3. Long-term bets (high impact, high complexity)
4. Deprioritized (low impact/high complexity)

Include dependencies and user value for each."
            {:name "generate-roadmap"})))

  {:status :success
   :result {:report report
            :total-features (length scored)}})
```

**Trigger**: Weekly or before planning sessions

**Value**: Data-driven prioritization, surfaces quick wins

---

## Workflow 3: **Doc Cleanup - Archive Implemented Features**

**Problem**: `docs/plans/` has completed features that should move to `docs/archived/`

**Workflow**:

```sema
(defworkflow archive-implemented-docs
  {:phases ["Scan" "Verify" "Move"]
   :budget {:usd 1.00}}

  (phase "Scan")
  (def repo-root (or (:repo-root *workflow-args*) "."))
  (def plans (checkpoint :plans (file/glob (str repo-root "/docs/plans/*.md"))))

  (phase "Verify")
  ;; Check if each plan is implemented
  (def verifications
    (checkpoint :verifications
      (parallel
        (map (lambda (plan-file)
               (lambda ()
                 (let ((content (file/read plan-file))
                       (filename (path/basename plan-file)))
                   (step f"Is this feature implemented and ready to archive?

Plan: ${filename}
Content: ${content}

Check:
1. Does it say 'Status: Done' or similar?
2. Search the codebase - is this feature actually merged?
3. Are there any TODO/WIP markers?

Return JSON: {{\"implemented\": boolean, \"evidence\": \"...\", \"summary\": \"one-line\"}}"
                         {:name "verify-implementation"
                          :schema {:implemented :boolean
                                   :evidence :string
                                   :summary :string}}))))
             plans)
        4)))

  (phase "Move")
  ;; Archive implemented plans
  (def moves
    (checkpoint :moves
      (map (lambda (verification plan-file)
             (if (:implemented verification)
               (let ((archive-dir (str repo-root "/docs/archived/"))
                     (filename (path/basename plan-file))
                     (dest (str archive-dir filename)))
                 (begin
                   ;; Ensure archive dir exists
                   (shell f"mkdir -p ${archive-dir}")
                   ;; Move file
                   (shell f"mv ${plan-file} ${dest}")
                   {:moved true :from plan-file :to dest :summary (:summary verification)}))
               {:moved false :file plan-file :reason "not implemented"}))
           verifications
           plans)))

  {:status :success
   :result {:moved (filter :moved moves)
            :skipped (filter (lambda (m) (not (:moved m))) moves)}})
```

**Trigger**: Monthly or after major releases

**Value**: Keeps docs clean, clear signal of completed work

---

## Workflow 4: **Sema Ecosystem Cross-Repo Sync**

**Problem**: 15+ editor plugin repos need version bumps when core sema releases

**Workflow**:

```sema
(defworkflow sync-sema-ecosystem
  {:phases ["Discover" "Check" "Update" "PR"]
   :budget {:usd 1.50}}

  (phase "Discover")
  (def repos
    (checkpoint :repos
      (list "sema-lisp/vscode-sema"
            "sema-lisp/zed-sema"
            "sema-lisp/intellij-sema"
            "sema-lisp/emacs-sema"
            "sema-lisp/helix-sema"
            "sema-lisp/sema.nvim"
            "sema-lisp/sema.vim"
            "sema-lisp/sublime-sema"
            "sema-lisp/pi-sema")))

  (def latest-sema-version
    (checkpoint :latest-version
      (shell "gh release view --repo sema-lisp/sema --json tagName --jq .tagName")))

  (phase "Check")
  ;; Check each repo's sema version
  (def versions
    (checkpoint :versions
      (parallel
        (map (lambda (repo)
               (lambda ()
                 (step f"What version of sema does this repo reference?

Repo: ${repo}
Latest sema version: ${latest-sema-version}

Check package.json, Cargo.toml, README.md, etc.
Return JSON: {{\"current_version\": \"...\", \"needs_update\": boolean}}"
                       {:name "check-version"
                        :schema {:current_version :string
                                 :needs_update :boolean}})))
             repos)
        8)))

  (phase "Update")
  ;; For repos needing updates, create a branch and update files
  (def updates
    (checkpoint :updates
      (map (lambda (repo version-info)
             (if (:needs_update version-info)
               (let ((branch-name (str "chore/bump-sema-" latest-sema-version)))
                 (step f"Generate shell commands to:
1. Clone ${repo}
2. Create branch ${branch-name}
3. Update version references from ${(:current_version version-info)} to ${latest-sema-version}
4. Commit with message 'chore: bump sema to ${latest-sema-version}'

Return as JSON array of shell commands."
                       {:name "generate-update-commands"}))
               nil))
           repos
           versions)))

  (phase "PR")
  ;; Open PRs for each update
  ;; (This would shell out to gh pr create, omitted for brevity)

  {:status :success
   :result {:repos-checked (length repos)
            :needs-update (length (filter :needs_update versions))}})
```

**Trigger**: After sema core releases

**Value**: Keeps ecosystem in sync, prevents version drift

---

## Workflow 5: **Mutation Testing (Monkeywrench)**

**Problem**: Want to sporadically verify test suite catches random breakage

**Workflow**:

```sema
(defworkflow monkeywrench-testing
  {:phases ["Select" "Mutate" "Test" "Report"]
   :budget {:usd 0.75}}

  (phase "Select")
  (def repo (or (:repo *workflow-args*) "~/code/sema"))
  (def source-files
    (checkpoint :source-files
      (file/glob (str repo "/src/**/*.rs"))))  ;; For sema; adjust per project

  (def target-files
    (checkpoint :targets
      (take 5 (shuffle source-files))))  ;; Random 5 files

  (phase "Mutate")
  ;; For each file, generate a mutation
  (def mutations
    (checkpoint :mutations
      (map (lambda (file)
             (let ((content (file/read file)))
               (step f"Generate a plausible mutation for this code:

File: ${file}
Content: ${content}

Mutation types:
- Flip a comparison (> to >=, == to !=)
- Change a constant (0 to 1, true to false)
- Remove a condition
- Swap function calls

Return JSON: {{\"mutation\": \"what to change\", \"line\": N, \"original\": \"...\", \"mutated\": \"...\"}}"
                     {:name "generate-mutation"
                      :schema {:mutation :string
                               :line :number
                               :original :string
                               :mutated :string}})))
           target-files)))

  (phase "Test")
  ;; Apply mutation, run tests, revert
  (def results
    (checkpoint :results
      (map (lambda (mutation file)
             (let ((backup (file/read file)))
               ;; Apply mutation (simplified - real impl would parse/replace)
               ;; Run tests
               (let ((test-result (shell "cargo test 2>&1")))
                 ;; Revert
                 (file/write file backup)
                 {:file file
                  :mutation (:mutation mutation)
                  :tests-failed (string/contains? test-result "FAILED")
                  :output test-result})))
           mutations
           target-files)))

  (phase "Report")
  (def report
    (checkpoint :report
      (step f"Analyze mutation test results:

${(json/encode results)}

Report:
1. How many mutations were caught (tests failed)?
2. How many escaped (tests passed)?
3. Which areas have weak test coverage?

Return markdown summary."
            {:name "generate-report"})))

  {:status :success
   :result {:report report
            :mutations-tested (length results)
            :caught (length (filter :tests-failed results))}})
```

**Trigger**: Weekly random run

**Value**: Discovers weak test coverage, builds confidence

---

## Deployment Strategy

**Phase 1**: Start with **Dependabot Auto-Merge** (lowest risk, immediate value)

**Phase 2**: Add **Doc Cleanup** (safe, nice QoL improvement)

**Phase 3**: Add **Feature Prioritization** (requires tuning, high value)

**Phase 4**: Build **Sema Ecosystem Sync** and **Mutation Testing** (nice-to-haves)

All workflows designed to run on **cron** or **webhook** triggers, no human in loop required.
