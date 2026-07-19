---
name: sema
description: Write, inspect, format, run, and debug Sema Lisp; create persistent Sema deftools; and author or resume Sema workflows. Use for .sema files, Sema syntax or builtin questions, Sema errors, deftool or defworkflow code, or when using sema_eval, sema_run_file, sema_fmt, sema_docs, sema_docs_search, create_sema_tool, submit_sema_workflow, or sema_workflow_run.
compatibility: Requires the pi-sema native tools or a compatible sema CLI on PATH.
metadata:
language: sema
package: pi-sema
---

---

# Sema

## Objective

Produce Sema code that is verified against the current documentation and runtime.
Prefer Pi's native `sema_*` tools. Use the CLI only when the native tool is unavailable.

## Operating loop

1. **Choose the execution surface.**

   - One expression, a small reproduction, or a function call: `sema_eval`.
   - An existing `.sema` file: `sema_run_file`.
   - Formatting: `sema_fmt`.
   - An unknown builtin or uncertain argument order: `sema_docs_search`, then
     `sema_docs` for the exact symbol.
   - Reusable persistent behavior callable as a tool: `create_sema_tool`.
   - A durable, resumable, budgeted multi-step process: `submit_sema_workflow`,
     then `sema_workflow_run`.

2. **Resolve uncertain APIs before writing code.** Never invent a builtin name,
   option, or argument order.
3. **Make the smallest complete change.** Preserve the surrounding project's
   conventions unless the user asks for a broader refactor.
4. **Format and execute the changed path.** Loading successfully is not enough;
   call every new or changed function at least once.
5. **Report evidence.** State what was run, what passed, and what remains
   unverified. Do not claim completion from inspection alone.

## Source of truth

- The current `sema_docs*` results and runtime behavior override examples in this
  skill when they disagree.
- Use `sema_docs_search` for natural-language discovery. Search results include a
  `signature`; preserve its argument order.
- Use `sema_docs` for an exact symbol after identifying the likely builtin.
- If native Pi tools are unavailable, use the CLI fallback below.
- If neither native tools nor the CLI can run, provide the code but label it
  explicitly as unverified.

## Language rules

- Sema is a Scheme-flavored Lisp, not JavaScript, Python, or Clojure.
- Builtins are slash-namespaced, such as `string/join`, `file/read`, and
  `regex/replace-all`. Predicates conventionally end in `?`.
- Do not guess aliases from other languages. There is no `string/concat`; use
  the documented `string/append` or `string/join`. There is no `llm/generate`;
  use `llm/complete`.
- Free variables resolve at call time. Code may load successfully and still fail
  when a function is first invoked.
- `(sleep n)` uses milliseconds.
- Core syntax includes maps `{:k v}`, vectors `[1 2 3]`, keywords `:k`, f-strings
  `f"x is ${x}"`, regex literals `#"pat"`, short lambdas `#(+ % 1)`, and
  threading `(-> x f g)`.

## Verification standard

For changed Sema code, perform the applicable checks in this order:

1. Look up every non-obvious builtin and confirm its signature.
2. Format the file or snippet.
3. Evaluate the smallest failing or newly added expression.
4. Run the containing file when file-level loading or side effects matter.
5. Exercise the success path and one meaningful edge or failure path when
   practical.
6. For forged tools, invoke the tool in the same turn after live registration.
7. For workflows, run or resume a real invocation and inspect the resulting
   status or journal evidence.

Stop and report the exact blocker when a required check cannot be performed.

## Persistent tools (`deftool`)

Use a tool for bounded, reusable behavior that should be callable repeatedly.
Do not forge a persistent tool for a one-off expression or temporary experiment.

```sema
(deftool tool-name
  "One-line description"
  {:param {:type :string :description "..."}
   :count {:type :number}}
  (lambda (param count)
    ...))
```

Rules:

- Parameter types are `:string`, `:number`, `:boolean`, `:list`, and `:map`.
- Lambda parameters follow the schema map order and their names must match.
- Give every parameter a useful description when its meaning is not obvious.
- Do not prefix the tool name with `_` or set `:mcp/expose #f`; both hide it.
- Keep execution bounded. Do not call `(exit)` or create unbounded loops inside
  the long-running host process.
- Make file, network, process, database, environment, or LLM side effects clear
  in the name, docstring, and parameters. Minimize capabilities.
- Prefer project scope for repository-specific tools and global scope only for
  broadly reusable behavior.
- Create or update through `create_sema_tool`. Its lifecycle is verification,
  preview, approval, storage, and live registration. Do not bypass that flow by
  editing the stored file directly.
- Stored file edits do not hot-reload. Re-forge the tool.
- After registration, exercise the Sema symbol with `sema_eval`, for example
  `(tool-name ...args)`, and test any native Pi wrapper exposed by the plugin.

## Workflows (`defworkflow`)

Use a workflow when the job benefits from checkpoints, resumability, budgets,
parallel or pipelined work, journaled LLM steps, or explicit phases. Workflows
are separate from tools.

```sema
(defworkflow name "doc"
  {:phases ["Plan" "Execute"] :budget {:usd 2.0}}
  (phase "Plan")
  (checkpoint :items (string/split (file/read "in.txt") "\n"))
  (phase "Execute")
  (checkpoint :out
    (parallel
      (map (lambda (i)
             (lambda ()
               (step f"process ${i}" {:name "proc"})))
           (checkpoint :items))
      8))
  {:status :success :result (checkpoint :out)})
```

Rules:

- `(phase "Name")` is a marker and takes exactly one argument.
- `(step prompt {:name ... :schema ... :tools [...] :agent A})` is the journaled
  LLM leaf.

  - `:schema` requests typed extraction; bare keyword specs such as
    `{:total :number}` are shorthand.
  - `:tools` enables a tool loop.
  - `:agent` runs a loaded `defagent`.

- `(checkpoint :k v)` writes durable run state; `(checkpoint :k)` reads it.
- `(parallel thunks n)` is barrier fan-out with a maximum concurrency of 8.
- `(pipeline items stages...)` processes each item through stages without a
  global barrier.
- JSON passed with `--args` is bound to `*workflow-args*`; read values with
  `(:key *workflow-args*)`.
- Stored agents are not auto-loaded. Load the required agent file before use.
- End the workflow body with a result map such as
  `{:status :success :result ...}`.
- Submit through `submit_sema_workflow` for static checking, preview, and
  approval.
- Run through `sema_workflow_run`. Resume with the existing run ID after a fix;
  completed memoized steps replay without repeating their cost.

## CLI fallback

Use these only when the equivalent `sema_*` tool is unavailable:

- Run a file: `sema path/to/file.sema`. There is no `sema run` subcommand.
- Evaluate one expression: `sema -e '(+ 1 2)'`.
- Structured evaluation: `sema eval --stdin --json`.
- Script arguments: `sema script.sema -- a b`.
- Format: `sema fmt <file>`.
- Check a workflow: `sema workflow check <file> --strict --json`.
- Build a standalone binary: `sema build <file>`.

The structured evaluation envelope is:

```text
{ok, value, stdout, stderr, error: {message, hint, line, col}}
```

The error object is nested. The CLI `--timeout` flag is currently ineffective;
enforce timeouts in the caller. Workflow warnings may produce a non-zero exit
status, so gate on the parsed `errors` count rather than the exit code alone.

## Debugging

1. Reproduce the exact failing call with `sema_eval`, or with
   `sema eval --stdin --json` as fallback.
2. Read `error.message`, `error.hint`, `error.line`, and `error.col`; the hint may
   contain a did-you-mean suggestion.
3. For an unbound variable or arity error, verify the exact symbol and signature
   before editing.
4. Remember that free-variable failures may appear only when the function is
   called.
5. For workflow failures, inspect `.sema/runs/<id>/events.jsonl`, fix the cause,
   and resume the same run ID so completed steps can replay from memo.
6. If documentation and behavior differ, record the Sema version and trust the
   observed runtime while flagging the mismatch.

## Completion response

When finishing a Sema task, include:

- files or persistent definitions changed;
- native tools or CLI commands used for verification;
- the observed result of the final execution; and
- any path that remains untested or any runtime/docs mismatch discovered.
