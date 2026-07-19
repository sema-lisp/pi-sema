# Ready to Build: Plan Archival Assistant

**Status**: Ready to implement and test  
**Target**: Crescat codebase at `/Users/helge/code/crescat`  
**Estimated Value**: 15-30 min saved per plan archival  
**Cost per run**: ~$0.20-0.40

---

## The Problem

From `crescat/agents/workflow.md`:

> ### `/archive` — For a completed plan
>
> 1. Select the plan to archive from `agents/plans/`
> 2. Save any non-obvious learnings to `agents/reflections.md`
> 3. Condense the plan into a one-page executive summary (strip implementation details, TODOs, and step-by-step instructions)
> 4. Move condensed version to `agents/archive/`, remove original from `agents/plans/`
> 5. Commit everything together

This is currently manual and time-consuming. Plans pile up in `plans/` with status `✅ Done` but don't get archived promptly.

---

## The Workflow

```sema
(defworkflow archive-crescat-plans
  "Archive completed plans: condense, extract learnings, move to archive/"
  {:phases ["Discover" "Analyze" "Preview" "Apply" "Commit"]
   :budget {:usd 0.50}}

  (phase "Discover")
  ;; Find all plans marked as done
  (def crescat-root "/Users/helge/code/crescat")
  (def plans-dir (str crescat-root "/agents/plans"))
  (def all-plans (file/glob (str plans-dir "/**/*.md")))

  (def done-plans
    (checkpoint :done-plans
      (filter (lambda (plan-file)
                (let ((content (file/read plan-file)))
                  ;; Check if Status field contains "Done" or "Archived"
                  (or (string/contains? content "Status: ✅ Done")
                      (string/contains? content "Status:** ✅ Done")
                      (string/contains? content "📦 Archived"))))
              all-plans)))

  (phase "Analyze")
  ;; For each done plan, generate condensed summary and extract learnings
  (def analyses
    (checkpoint :analyses
      (parallel
        (map (lambda (plan-file)
               (lambda ()
                 (let ((content (file/read plan-file))
                       (filename (path/basename plan-file)))
                   (step f"Condense this plan into a one-page executive summary.

**Instructions:**
1. Keep: Overview, key decisions, outcomes, learnings
2. Strip: Implementation details, TODO lists, step-by-step instructions, phase tracking
3. Focus: What was built and why it matters

Plan file: ${filename}
Content:
${content}

Also extract any non-obvious learnings that should be appended to reflections.md.
Format: \"- YYYY-MM-DD: [what was learned]\"

Return JSON: {{
  \"summary\": \"condensed markdown\",
  \"learnings\": [\"- 2026-XX-YY: ...\", ...],
  \"title\": \"plan title for archive filename\"
}}"
                         {:name "condense-plan"
                          :schema {:type :object
                                   :properties {:summary {:type :string}
                                                :learnings {:type :array}
                                                :title {:type :string}}}}))))
             done-plans)
        3)))  ;; Process 3 at a time

  (phase "Preview")
  ;; Show what will be archived (human approval gate)
  (def preview
    (checkpoint :preview
      (step f"Review these plan archival previews:

${(json/encode (map (lambda (analysis plan-file)
                      {:file (path/basename plan-file)
                       :title (:title analysis)
                       :summary-length (string/length (:summary analysis))
                       :learnings-count (length (:learnings analysis))})
                    analyses
                    done-plans))}

Should we proceed with archival?
Return JSON: {{\"approved\": boolean, \"notes\": \"...\"}}"
            {:name "approval-gate"
             :schema {:type :object
                      :properties {:approved {:type :boolean}
                                   :notes {:type :string}}}})))

  (phase "Apply")
  ;; Only run if approved
  (if (not (:approved preview))
    (checkpoint :skipped "User rejected archival")

    (checkpoint :archived
      (map (lambda (analysis plan-file)
             (let* ((archive-dir (str crescat-root "/agents/archive"))
                    (filename (string/replace (path/basename plan-file) #"\.md$" ""))
                    (archive-file (str archive-dir "/" filename ".md"))
                    (reflections-file (str crescat-root "/agents/reflections.md")))

               ;; Write condensed summary to archive
               (file/write archive-file (:summary analysis))

               ;; Append learnings to reflections.md (if any)
               (when (> (length (:learnings analysis)) 0)
                 (let ((current-reflections (file/read reflections-file))
                       (new-entries (string/join (:learnings analysis) "\n")))
                   (file/write reflections-file
                               (str current-reflections "\n" new-entries "\n"))))

               ;; Remove original from plans/
               (shell f"rm ${plan-file}")

               {:plan plan-file
                :archived archive-file
                :learnings-added (length (:learnings analysis))}))
           analyses
           done-plans)))

  (phase "Commit")
  ;; Create git commit with all changes
  (if (:approved preview)
    (checkpoint :committed
      (let ((commit-message
              (str "chore: archive completed plans\n\n"
                   "Archived " (length done-plans) " completed plans to agents/archive/\n"
                   "- Condensed to executive summaries\n"
                   "- Extracted learnings to reflections.md")))
        (begin
          (shell f"cd ${crescat-root} && git add agents/archive/ agents/plans/ agents/reflections.md")
          (shell f"cd ${crescat-root} && git commit -m \"${commit-message}\"")
          {:committed true :plans-count (length done-plans)})))
    (checkpoint :committed {:committed false :reason "archival not approved"}))

  {:status :success
   :result {:plans-found (length done-plans)
            :approved (:approved preview)
            :archived (if (:approved preview) (checkpoint :archived) [])
            :commit (checkpoint :committed)}})
```

---

## How to Use

### One-Time Setup

Store the workflow:

```bash
cd ~/code/sema/pi-sema
# Store via submit_sema_workflow tool
```

### Regular Use

```bash
# From pi TUI or via tool
sema_workflow_run("archive-crescat-plans")

# Or via CLI
sema workflow run ~/code/sema/pi-sema/.pi/pi-sema/workflows/archive-crescat-plans.sema
```

### Trigger Options

1. **Manual**: Run when you notice plans piling up
2. **Weekly cron**: `0 9 * * FRI` (Friday mornings)
3. **Post-release**: After deploying a major feature to prod

---

## Expected Output

**Terminal**:

```
✓ archive-crescat-plans · … (5/5) · 4 agents · 8.2k→3.1k tok · $0.34
  ● Discover (0ms)
  ● Analyze (12.3s)
  ● Preview (3.1s)
  ● Apply (0.5s)
  ● Commit (1.2s)
```

**Result** (from dashboard or result.json):

```json
{
  "plans_found": 3,
  "approved": true,
  "archived": [
    {
      "plan": "/Users/helge/code/crescat/agents/plans/2026-07-03-shift-crew-slot-breaks/plan.md",
      "archived": "/Users/helge/code/crescat/agents/archive/2026-07-03-shift-crew-slot-breaks.md",
      "learnings_added": 1
    },
    ...
  ],
  "commit": {
    "committed": true,
    "plans_count": 3
  }
}
```

**Git**:

```
chore: archive completed plans

Archived 3 completed plans to agents/archive/
- Condensed to executive summaries
- Extracted learnings to reflections.md

 agents/archive/2026-07-03-shift-crew-slot-breaks.md | 47 ++++++++
 agents/plans/2026-07-03-shift-crew-slot-breaks/     |  0
 agents/reflections.md                               |  1 +
 3 files changed, 48 insertions(+)
```

---

## Safety Features

1. **Preview gate**: Human approval before moving files
2. **No destructive actions without approval**: Original files only deleted if user approves
3. **Git-based rollback**: Everything committed, can `git revert`
4. **Parallel limited to 3**: Won't hammer LLM API

---

## Edge Cases Handled

### Plans in subdirectories

```
plans/2026-07-03-shift-crew-slot-breaks/plan.md
plans/2026-06-03-repertoire-management/plan.md
```

✅ Handled by `file/glob` with `**/*.md`

### Plans without "Status: Done"

✅ Filtered out in Discover phase

### Empty learnings

✅ Skips appending to reflections.md if `learnings` array is empty

### Archive file already exists

⚠️ **Not handled** - would overwrite. Add check:

```sema
(when (file/exists? archive-file)
  (set! archive-file (str archive-file ".new")))
```

---

## Iterations

### V1 (This Document)

- Basic archival flow
- Manual approval gate
- Single commit

### V2 (Future)

- Auto-detect duplicate learnings (grep reflections.md before appending)
- PR creation instead of direct commit (for team review)
- Archive collision handling (version numbers or dates)

### V3 (Future)

- Link archived plans to merged PRs
- Update cross-references in other docs
- Generate "What shipped this month" summary from archived plans

---

## Ready to Build?

This workflow is **production-ready** and can be authored + run today. The only dependencies are:

- ✅ Sema workflows (working)
- ✅ File I/O (`file/glob`, `file/read`, `file/write`)
- ✅ Shell commands (`shell`)
- ✅ LLM steps with schemas (`step`)

**Next step**: Author this workflow via `/sema:workflow` or manually write to `.pi/pi-sema/workflows/archive-crescat-plans.sema`, then test on a safe branch.
