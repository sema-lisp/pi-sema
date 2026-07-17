---
name: sema
description: Deep reference for writing Sema code — authoring deftools and defworkflows, stdlib conventions, CLI usage, and debugging. Use when writing or editing .sema files, forging tools with create_sema_tool, authoring workflows with submit_sema_workflow, or debugging Sema errors.
---

# Writing Sema

Sema is a Scheme-flavored Lisp with first-class LLM primitives. This skill is the
deep reference; the always-on system-prompt note covers only the basics.

## Ground rules

- Sema is NOT JavaScript, Python, or Clojure. Builtins are slash-namespaced
  (`string/join`, `file/read`, `regex/replace-all`); predicates end in `?`.
- **Never guess a builtin name.** Verify with `sema_docs_search` (natural-language
  query; hits include a `signature` field with argument ORDER) or `sema_docs`
  (exact symbol). Common traps: there is no `string/concat` (use `string/append`
  or `string/join`), no `llm/generate` (use `llm/complete`).
- Free variables resolve at CALL time — code that loads fine can still crash on
  first use. Exercise every new function with `sema_eval` before declaring done.
- `(sleep n)` is milliseconds. Maps `{:k v}`, vectors `[1 2 3]`, keywords `:k`,
  f-strings `f"x is ${x}"`, regex literals `#"pat"`, short lambdas `#(+ % 1)`,
  threading `(-> x f g)`.

## Tools (deftool)

```sema
(deftool tool-name
  "One-line description"
  {:param {:type :string :description "..."}
   :count {:type :number}}
  (lambda (param count)
    ...))
```

- Param types: `:string :number :boolean :list :map`. Lambda params follow the
  map order and names must match.
- Don't prefix names with `_` and don't set `:mcp/expose #f` — both hide the tool.
- Runs inside a live long-running process: no `(exit)`, no unbounded loops.
- Create/update via the `create_sema_tool` tool (verify → approve → store →
  live-register). Editing the stored `.sema` file does NOT hot-reload — re-forge.
- Exercise a just-forged tool in the SAME turn via `sema_eval`: `(tool-name …args)`.

## Workflows (defworkflow)

Workflows are journaled, resumable, budgeted pipelines — separate from tools.

```sema
(defworkflow name "doc"
  {:phases ["Plan" "Execute"] :budget {:usd 2.0}}
  (phase "Plan")                                ; marker, exactly 1 arg
  (checkpoint :items (string/split (file/read "in.txt") "\n"))
  (phase "Execute")
  (checkpoint :out
    (parallel (map (lambda (i) (lambda () (step f"process ${i}" {:name "proc"})))
                   (checkpoint :items))
              8))
  {:status :success :result (checkpoint :out)})
```

- `(step prompt {:name … :schema … :tools […] :agent A})` — the journaled LLM
  leaf. `:schema` → typed extraction (bare keyword specs like `{:total :number}`
  are typed shorthand); `:tools` → tool loop; `:agent` → run a defagent.
- `(checkpoint :k v)` write / `(checkpoint :k)` read — the run's durable state.
- `(parallel thunks n)` barrier fan-out (cap 8); `(pipeline items stages…)`
  per-item flow without a barrier.
- Args come from `--args` JSON bound to `*workflow-args*`: `(:key *workflow-args*)`.
- Stored defagents are NOT auto-loaded: `(load "/path/agent.sema")` first.
- End the body with a `{:status :success :result …}` map.
- Author via `submit_sema_workflow` (static check → preview → approval), run via
  `sema_workflow_run` (live status; `resume=<run-id>` replays memoized steps free).

## CLI (when sema_* tools are unavailable)

- Run a file: `sema path/to/file.sema` — there is NO `sema run` subcommand.
- One-liner: `sema -e '(+ 1 2)'`; structured: `sema eval --stdin --json`
  (envelope `{ok, value, stdout, stderr, error: {message, hint, line, col}}` —
  the error object is nested).
- Script args after `--`: `sema script.sema -- a b`.
- `sema fmt <file>`, `sema workflow check <file> --strict --json` (gate on the
  parsed `errors` count — warnings alone flip the exit code), `sema build <file>`
  for standalone binaries.
- The CLI `--timeout` flag is a no-op; enforce timeouts externally.

## Debugging

1. Reproduce with `sema_eval` (or `sema eval --stdin --json`) — the envelope's
   `error.hint` often carries a did-you-mean.
2. Unbound variable? Verify the name with `sema_docs_search` before editing.
3. Workflow failures: the run journal under `.sema/runs/<id>/events.jsonl` has
   per-step evidence; re-run with `resume=<id>` after fixing — completed steps
   replay from memo for free.
