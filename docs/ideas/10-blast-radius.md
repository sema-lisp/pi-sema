# Blast Radius: call-hierarchy gate before shared-tool edits
> Before a shared deftool changes, show the agent (and the human approving it) exactly who calls it — not a grep guess, a real symbol graph.

## Why (the non-obvious insight)

pi-sema's forge already has the *one* human gate that matters (`create_sema_tool`'s `ctx.ui.confirm` in `src/forge/forge.ts:106-117`) but it shows the source diff, not the *impact* — the approval text is `"Create Sema tool X? <description> <source>"` with zero information about what else depends on the symbol being redefined. Meanwhile `sema-lsp` already computes exactly this graph server-side: `crates/sema-lsp/src/server.rs` implements full LSP call hierarchy (`CallHierarchyPrepare`/`Incoming`/`Outgoing`, lines 123-136, 651-692), `textDocument/references` (line 369), and `prepareRename`/`rename` (lines 488, 507). None of it is wired into pi-sema today — there is no LSP client anywhere under `src/`. The Claude Code issue #40282 finding ("agents use ~10% of LSP") is exactly the gap here: pi-sema has a bridge to Sema's *runtime* but not to its *language server*, so every forge edit is source-text-blind to its blast radius even though the data already exists one process away.

## How it works (user-visible behavior, step by step)

1. Session start: pi-sema fires `workspace/didChangeConfiguration`-style warm-up — really just opens the workspace root so `ScanWorkspace`/`ScanWorkspaceContinue` (server.rs:163-165, 1016-1047) indexes symbols incrementally, no files opened in an editor sense.
2. Agent calls `create_sema_tool` to redefine an existing `deftool`, or the Silent Compiler Gate (idea 3) fires on an edit to a `.sema` file that's referenced elsewhere.
3. A new `blast_radius(symbol)` pi tool: `prepareCallHierarchy` → `incomingCalls` + `outgoingCalls`, plus a `references` sweep, assembled into a small impact tree.
4. The forge approval overlay (`ctx.ui.confirm` call site in `forge.ts`) gets a third paragraph: `"Impact: called by 3 workflows (build-release, nightly-check, ...) and 2 forged tools (pdf-extract, report-gen). Renaming? Route through LSP rename instead of text edits."` The human sees real numbers, not "trust me."
5. If the symbol has zero incoming callers, the overlay stays exactly as it is today — no noise for leaf tools.
6. Rename operations specifically get short-circuited to `prepareRename`+`rename` (workspace-wide `WorkspaceEdit`) instead of the model hand-editing N files — safer and cheaper.

## Architecture (real modules)

- **New `src/lsp/client.ts`** (doesn't exist yet — this idea's biggest lift): a JSON-RPC-over-stdio client for `sema lsp` (or whatever launches `sema-lsp`), sibling to `src/bridge/jsonrpc.ts` which already implements the exact same LSP-flavored JSON-RPC framing for the MCP bridge — largely reusable.
- **New `src/lsp/process.ts`** — lifecycle owner mirroring `src/bridge/process.ts`'s `McpProcess` (spawn once per session, restart-once-on-crash pattern already proven there).
- **`src/forge/forge.ts`** — the `ctx.ui.confirm` call (lines 107-110) gains a blast-radius paragraph; requires a `getRuntime()`-reachable LSP client alongside `bridge`/`store` in `PiSemaRuntime` (`src/index.ts:18-22`).
- **`blast_radius` pi tool** — registered alongside `sema_status` (pattern in `bridge.ts:61-83`): works even when the eval bridge is up/down since it only needs the LSP process.
- **Idea 3 (Silent Compiler Gate)** consultation point — wherever that idea hooks `.sema` file edits (likely a pi file-edit hook), it calls the same `blast_radius` before surfacing diagnostics, so a risky edit to a widely-called symbol gets flagged pre-save, not just pre-forge.
- **Data flow**: `sema-lsp` process (persistent, workspace-indexed) → LSP client → `blast_radius(symbol)` → impact tree → forge approval overlay text + (future) dashboard panel.

## Grounding & prior art

LSP capability inventory insight (call hierarchy present, code actions absent — pi becomes the action layer); Claude Code issue #40282 "agents use ~10% of LSP" insight; agent-lsp blast-radius pattern; workspace-scan-for-dedup insight.

## Effort & risks

**Effort: M**

1. **No LSP client exists in pi-sema today** — this is a new subsystem, not a wire-up. Mitigation: `bridge/jsonrpc.ts` already solves the framing/dispatch problem for a structurally similar protocol; scope v1 to prepare+incoming+outgoing+references only, skip diagnostics/completions.
2. **Workspace scan cost on large repos** — `ScanWorkspaceContinue` is explicitly incremental/deferred (server.rs:1023, pushed back onto a work queue) to avoid blocking, but a cold-start scan on a big monorepo could still lag the first forge call. Mitigation: kick the scan at `session_start` (parallel with `bridge.start()`), not on first use.
3. **Impact tree accuracy on dynamic dispatch** — Sema's `eval`-based deftool injection means some call edges (calling a tool by string name via `(call name ...)`-style indirection) won't show up in static call hierarchy. Mitigation: state this limitation plainly in the overlay text ("static callers only — dynamic dispatch not shown") rather than implying completeness.

## Open questions

- Is there already a `sema lsp` subcommand / stdio entry point pi-sema can spawn the same way it spawns `sema mcp`, or does this require a new sema CLI flag?
- Should the LSP client be always-on (like the MCP bridge) or lazily spawned only when a forge/edit event needs it, to save a process for sessions that never touch shared tools?
- How does blast radius interact with cross-tier shadowing (project tier shadows global by name, per `LibraryStore`) — does a rename need to check both tiers' symbol tables?
