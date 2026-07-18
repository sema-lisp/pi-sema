# Form Runner: per-form eval overlay via sema.runTopLevel

> Turn the LSP's "Run" code lens into a pi overlay that runs exactly one top-level form, not the whole file.

## Why (the non-obvious insight)

Sema's LSP already ships the engine behind a REPL-driven workflow: `workspace/executeCommand` with `sema.runTopLevel` (`sema-lsp/src/handlers/command.rs:38-126` in the mono, `sema/crates/sema-lsp`) evaluates exactly one top-level form at a given position and shells out to the configured `sema` binary to do it. Every verification path pi-sema currently has runs at file or process granularity: the forge's `verifyToolSource` (`src/forge/probe.ts`) spawns a whole `sema eval --stdin` process over the entire candidate source, and `sema_workflow_run`/`run_file` run entire files. That's the right level of rigor for "does this compile and register," but it's the wrong level for "does this one function actually do the right thing" — the agent (and the human) end up re-running the whole file to sanity-check one deftool body or one test form, paying full re-evaluation cost and drowning the one signal they wanted in the rest of the output. pi-sema doesn't talk to the LSP at all today (confirmed: no `lsp`-related code anywhere in `src/`), so this is the first LSP integration — and the cheapest one, since it needs exactly one existing LSP capability plus `documentSymbol` for the picker, no new server-side work.

## How it works (user-visible behavior, step by step)

1. User (or agent) opens a `.sema` file and invokes a new command, e.g. `sema:run-form`, or the agent calls a new tool `run_form(file, symbol)`.
2. For the interactive path, pi opens a `ctx.ui.custom` overlay (same overlay pattern as `src/ui/dashboard.ts`'s `DashboardComponent`) listing every top-level form in the buffer, sourced from the LSP's `documentSymbol` response (`server.rs:436`, `document_symbol_provider`) — deftool/defagent/defn/def entries with line numbers.
3. Selecting a form (arrow keys + enter, mirroring the dashboard's `handleInput`) fires `workspace/executeCommand` with `sema.runTopLevel` at that form's position; the captured stdout/stderr/result streams back inline in the overlay in real time.
4. For the agent path, `run_form(file, symbol)` does the same LSP round-trip headlessly and returns the captured output as the tool result — no full-file execution, no side effects from unrelated forms in the same file.
5. The forge (`src/forge/forge.ts`) and the Silent Compiler Gate idea both get a cheaper verification rung: after a candidate deftool passes the strict-sandbox probe, `run_form` on just the generated test/example form gives a semantic smoke check beyond "it compiled" — without re-running the whole probe pipeline.

## Architecture (which pi-sema modules touched/added)

- New `src/lsp/client.ts`: a minimal LSP client over stdio, spawning `sema lsp` once per session (parallel to how `SemaBridge`/`McpProcess` in `src/bridge/process.ts` manage the long-lived `sema mcp` child) — `initialize`, `textDocument/didOpen`, `workspace/executeCommand`, `textDocument/documentSymbol`. Reuses the JSON-RPC framing already implemented for the MCP bridge in `src/bridge/jsonrpc.ts` (Content-Length-prefixed JSON-RPC is the same wire format LSP uses) rather than writing a second RPC layer from scratch.
- New `src/lsp/formrunner.ts`: the overlay component (`ctx.ui.custom`, `overlay: true`) and the `run_form` tool registration, following `registerDashboard`'s registration shape in `src/ui/dashboard.ts` (command + shortcut) and `registerWorkflowRunTool`'s tool shape in `src/workflows/runner.ts`.
- `src/index.ts`: add `registerFormRunner(pi, getRuntime)` alongside the other `register*` calls; the LSP client is session-scoped state like `SemaBridge`, started on `session_start` and stopped on `session_shutdown`.
- Optional: `LspClient.setSemaBinary(path)` wired to `SetSemaBinary` (`server.rs:161,196,1013`) so the overlay can target a worktree-local `sema` build — relevant when pi-sema itself is being developed against an unreleased `sema` (matches the workspace's worktree-heavy dev flow).
- Consumers: `src/forge/forge.ts` gains an optional post-approval step calling `run_form` on a generated smoke-test form before persisting; a future Silent Compiler Gate integration would call the same LSP client for `didOpen`/diagnostics.
- Data flow: `.sema` buffer → `didOpen`/`documentSymbol` (LSP) → overlay picker → `executeCommand sema.runTopLevel` at position → captured process output → overlay / tool result.

## Grounding & prior art (from the idea's grounding field)

`sema.runTopLevel` executeCommand insight ("click the code lens for the agent" — the LSP already implements exactly the granularity an agent needs, it just has no UI in pi today); LSP document-symbols capability (`document_symbol_provider`, `server.rs:229,436`) as a free, already-implemented form index; forge single-form verification relevance note (a cheap semantic check between "compiles" and "full sandbox run").

## Effort & risks

Effort: **S**

1. **First LSP integration in pi-sema — no existing client code to build on.** Mitigation: the JSON-RPC framing is already solved for the MCP bridge (`src/bridge/jsonrpc.ts`); LSP's Content-Length framing is the same shape, so this is a thin adapter, not new protocol work. Scope the client to exactly the three requests needed (`initialize`, `documentSymbol`, `executeCommand`) rather than a general-purpose LSP client.
2. **`sema.runTopLevel` executes with real side effects (it's not a strict-sandbox probe).** Mitigation: surface the same sandbox-mode disclosure the forge already gives ("verified in strict sandbox... will run UNSANDBOXED when called") in the overlay/tool description, and default `run_form` to read-only forms unless the user explicitly runs a deftool/defagent form.
3. **Running an out-of-order form (e.g. a form that references a `def` later in the file) fails confusingly.** Mitigation: surface the LSP's own diagnostic/error output verbatim in the overlay rather than reinterpreting it, and have the form picker visually group forms in file order so users notice ordering dependencies.

## Open questions

- Does `sema lsp` support multiple concurrent `didOpen` documents cheaply, or does pi-sema need to close/reopen on each file switch to avoid a growing server-side document set across a long session?
- Should `run_form` auto-run `didChange` with the agent's in-flight (unsaved) edit buffer, the same way the Silent Compiler Gate idea proposes for diagnostics — i.e. can the agent smoke-test a form before writing it to disk?
- Is there a way to get `sema.runTopLevel`'s captured value back structured (JSON) rather than raw stdout, for the `run_form` tool result to be machine-parseable?
