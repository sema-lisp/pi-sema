## Review

The existing skill is **technically strong but operationally incomplete**. Its best parts are the explicit warning against invented builtins, the call-time free-variable trap, same-turn testing of forged tools, and accurate workflow/CLI caveats.

The main improvements are:

- A decision procedure for choosing `sema_eval`, `sema_run_file`, forging, or workflows.
- Observable verification gates before claiming success.
- Explicit handling of runtime/documentation drift.
- Clearer boundaries between one-off code, persistent tools, and durable workflows.
- Capability and side-effect guidance for forged tools.
- A completion contract telling the agent what evidence to report.

That follows the useful parts of the supplied prompt-optimization skill: sequential work should have gates, completion evidence, traceable changes, and established checks before completion is claimed.

The expanded frontmatter is also important because Pi initially puts only skill names and descriptions into context, loading the full body on demand. The description therefore needs to mention the actual situations and tools that should activate it. ([Pi Dev][1])

[Download the improved SKILL.md](sandbox:/mnt/data/SKILL.improved.md)

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
   - A durable, resumable,file:/Users/helge/code/sema/pi-sema/prompts/sema-review.md

     file:/Users/helge/code/sema/pi-sema/prompts/sema-scratch.md budgeted multi-step process: `submit_sema_workflow`,
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

## Best additions to `pi-sema`

### 1. Dynamic forged-tool discovery

Once people have forged 30–100 tools, injecting every definition into the model becomes wasteful. Keep only something like `sema_tool_search` active initially:

1. Search the registry semantically.
2. Return matching names, descriptions, schemas, scope, and capabilities.
3. Activate selected tools for the next model request.
4. Optionally unload inactive Sema tools between turns.

Pi explicitly supports registering many tools while keeping only a small subset active, then adding tools dynamically with `pi.setActiveTools()`. This is almost perfectly designed for a self-growing Sema tool registry. ([Pi Dev][2])

### 2. Make forging a versioned artifact lifecycle

`/sema:forge` should produce a proper preview card containing:

- Generated source and source diff.
- Tool versus workflow classification.
- Project/global scope.
- Inferred capabilities.
- Static-check results.
- Generated smoke tests.
- Existing version being replaced.
- Source hash and Sema version.
- Approve, reject, edit, or dry-run action.

After approval, persist a registry entry containing provenance, test results, version history, and rollback data. Pi custom entries can store durable extension state without adding it to the LLM context, while custom renderers can present it as a rich TUI card. ([Pi Dev][2])

Useful operations:

```text
/sema:forge --dry-run ...
/sema:tools
/sema:tool inspect foo
/sema:tool history foo
/sema:tool rollback foo
/sema:tool disable foo
/sema:tool promote foo       # project → global
/sema:tool localize foo      # global → project override
```

### 3. `/sema:distill` — the killer feature

This is probably the most distinctive next feature.

After Pi successfully performs a useful sequence of work, run:

```text
/sema:distill
```

It examines the recent session and asks:

> “Is there a reusable operation hiding in what just worked?”

It then converts the successful interaction into:

- A `deftool` for bounded deterministic behavior.
- A `defworkflow` for durable multi-stage behavior.
- A `defagent` plus workflow when specialized judgment is involved.
- A generated test fixture based on the actual successful execution.

That turns the self-extension claim from “the agent can write tools” into:

> **Pi learns reusable capabilities from its own successful work.**

Never mutate automatically; generate, test, preview, and approve.

### 4. Capability manifests and honest sandboxing

Have the Sema verifier inspect the AST and report capabilities such as:

```text
filesystem.read
filesystem.write
network.http
process.spawn
environment.read
database.sqlite
llm.complete
pi.tool.call
```

These should appear in the forge preview and be enforceable through policies.

The important distinction is that an in-process TypeScript extension is not itself a security boundary. Pi extensions run with the user's permissions, and Pi deliberately has no built-in sandbox; real isolation requires a container, VM, micro-VM, or other OS boundary. ([Pi Dev][3])

A practical configuration could be:

```json
{
  "sema": {
    "sandbox": {
      "verification": "strict",
      "runtime": "host",
      "adapter": null
    }
  }
}
```

Then optionally support local adapters for Docker, Gondolin, or OpenShell:

```json
{
  "sema": {
    "sandbox": {
      "runtime": "isolated",
      "adapter": "gondolin",
      "network": "deny",
      "mounts": ["./workspace:rw"]
    }
  }
}
```

### 5. `/sema:doctor`

A single diagnostic command should check:

- Sema binary presence and version.
- `pi-sema`/Sema compatibility.
- MCP bridge health.
- Docs-index version versus runtime version.
- Eval, format, and file-run smoke tests.
- Project and global registry paths.
- Shadowed tools.
- Stale or invalid forged definitions.
- Workflow journal permissions.
- Sandbox adapter availability.
- Native registration of one temporary smoke-test tool.

This will save enormous debugging time as the package evolves.

### 6. Sema-aware session compaction

When Pi compacts a long conversation, preserve structured state that ordinary summarization may lose:

```text
Active forged tools and exact versions
Current workflow run IDs
Checkpoint keys
Pending approvals
Project/global shadowing decisions
Runtime/docs version mismatches
Capability grants
Files containing generated Sema definitions
```

Pi permits extensions to customize compaction and store implementation-specific structured details, making this feasible without dumping everything back into the prompt. ([Pi Dev][4])

### 7. Workflow-native TUI

Add `/sema:runs` with a proper interactive display:

```text
research-market-42
├─ ✓ Plan
├─ ✓ Discover                 $0.18
├─ ◉ Analyze       4 / 12     $0.44
├─ ○ Synthesize
└─ ○ Publish

Budget: $0.62 / $2.00
Checkpoints: 7
Memoized steps: 11
Estimated replay saving: $0.39
```

Actions could include resume, inspect journal, view checkpoint, abort, duplicate with new arguments, or open the workflow source. Pi supports custom UI components, streaming tool displays, dialogs, and persistent rendered entries. ([Pi Dev][2])

### 8. Semantic Sema inspection and editing

Add native tools such as:

```text
sema_inspect_file
sema_find_definition
sema_list_free_variables
sema_capabilities
sema_expand_form
sema_patch_form
sema_rename_symbol
```

`sema_patch_form` would replace a named top-level form through the parser rather than through text offsets. That gives the agent a safe, Lisp-aware editing path and avoids malformed parentheses, accidental duplicate definitions, and brittle search-and-replace edits.

### 9. Bidirectional Pi ↔ Sema tools

You already expose Sema functionality to Pi. The next step is letting Sema workflows invoke selected Pi tools:

```sema
(pi/tool-call :read {:path "src/main.rs"})
(pi/tool-call :bash {:command "cargo test"})
```

Only explicitly permitted Pi tools should cross the bridge. This would let Sema own orchestration while Pi remains the host for filesystem, shell, editor, browser, and third-party extension tools.

That makes `defworkflow` far more interesting: it can orchestrate the entire Pi environment rather than only Sema-native primitives.

### 10. Eventually, let Sema define Pi extensions

The wonderfully unreasonable end state:

```sema
(defpi-command "sema:hello"
  {:description "Say hello from Sema"}
  (lambda (args ctx)
    (pi/ui-notify ctx f"Hello ${args}")))

(pi/on :tool-call
  (lambda (event ctx)
    ...))
```

The TypeScript extension becomes a small host adapter exposing:

```text
pi/register-tool
pi/register-command
pi/on
pi/ui-confirm
pi/ui-select
pi/session-append
pi/tools-activate
pi/send-message
```

Then `pi-sema` is not merely “Sema support for Pi.” It becomes:

> **A Sema extension runtime embedded inside Pi.**

That fits the meta/dogfooding direction extremely well.

## Package structure I would move toward

Pi packages can bundle extensions, skills, prompt templates, and themes through the `pi` manifest. ([Pi Dev][5])

```text
pi-sema/
├── src/
│   ├── extension.ts
│   ├── registry/
│   ├── forge/
│   ├── workflows/
│   ├── sandbox/
│   └── tui/
├── skills/
│   └── sema/
│       ├── SKILL.md
│       └── references/
│           ├── language.md
│           ├── tools.md
│           ├── agents.md
│           ├── workflows.md
│           └── debugging.md
├── prompts/
│   ├── sema-review.md
│   ├── sema-migrate.md
│   └── sema-distill.md
├── tests/
└── package.json
```

The replacement above works well as a self-contained skill today. Later, I would reduce the top-level `SKILL.md` to roughly 80–100 lines and move the detailed tool, workflow, and debugging material into references. Pi's skill system is specifically designed around this progressive-disclosure structure. ([Pi Dev][1])

**My implementation order would be:** dynamic tool discovery, forge versioning/rendered cards, `/sema:doctor`, then `/sema:distill`. The first three make the package robust; the fourth makes it genuinely special.

[1]: https://pi.dev/docs/latest/skills "Skills · Documentation · Pi"
[2]: https://pi.dev/docs/latest/extensions "Extensions · Documentation · Pi"
[3]: https://pi.dev/docs/latest/security?utm_source=chatgpt.com "Security · Docs · Pi"
[4]: https://pi.dev/docs/latest/compaction?utm_source=chatgpt.com "Compaction & Branch Summarization · Docs · Pi"
[5]: https://pi.dev/docs/latest/packages "Pi Packages · Documentation · Pi"
