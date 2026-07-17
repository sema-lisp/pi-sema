# Silent Compiler Gate: LSP diagnostics on every .sema edit
> Turn Sema's compiler into an invisible correctness gate on ordinary agent edits — no sandbox execution required.

## Why (the non-obvious insight)
Pi-sema already pays for a strict-sandbox probe (`verifyToolSource` in `src/forge/probe.ts`) before persisting a forged tool — but that's a full `sema eval` subprocess spawn per attempt, and it only covers `create_sema_tool`, not the far more common case of an agent using pi's built-in `edit`/`write` tools directly on a `.sema` file in the repo. Those edits get zero compiler feedback until the next `sema_eval` or workflow run surfaces a syntax error two turns later — expensive in agent turns, not dollars. Sema's own LSP already does `didOpen`/`didChange` → `compile_diagnostics` push (sema-lsp/src/server.rs:799-841) as a pure parse/typecheck, no execution. A held-open `sema lsp` sidecar turns every edit into a one-round-trip compiler check, for free, in the same tool result the model already reads.

## How it works (user-visible behavior, step by step)
1. On session start, pi-sema spawns one long-lived `sema lsp` sidecar (parallel to the existing `sema mcp` bridge).
2. The agent calls pi's built-in `edit` or `write` tool on a `.sema` file.
3. pi-sema intercepts via pi v0.62+'s tool-override mechanism, sends the candidate buffer as `didOpen`/`didChange` to the sidecar before the edit lands on disk.
4. If diagnostics come back clean, the edit commits normally.
5. If diagnostics show errors, the tool result is the *edit result plus the compiler diagnostics appended* — the model sees "edit applied, but line 12: unbound variable `string/concat`" in the same turn and can self-repair immediately, instead of discovering it later via a failed `sema_eval` or workflow run.
6. The forge probe (`src/forge/probe.ts`) gets a free pre-flight: run the LSP check before spawning the strict-sandbox `sema eval` subprocess, so obviously-broken candidates never pay for a process spawn.

## Architecture
- New module `src/bridge/lsp.ts` (sibling to `src/bridge/process.ts`), modeled directly on `McpProcess`: single long-lived `spawn("sema", ["lsp"], { stdio: ["pipe","pipe","pipe"] })`, same crash/restart-once policy `McpProcess` implements (process.ts:62-80), same JSON-RPC framing pattern as `src/bridge/jsonrpc.ts` (LSP uses `Content-Length` framing rather than raw lines, so this needs the DAP-style client variant shared with ideas 01/02).
- Tool override: pi-sema currently only registers new tools (`pi.registerTool` calls across `src/forge/forge.ts`, `src/bridge/bridge.ts`, `src/workflows/runner.ts`); this idea is the first case of overriding a *built-in* pi tool. Needs a new `src/hooks/edit-gate.ts` wired from `src/index.ts` (where `registerForgeTool`/`registerDashboard`/etc. are currently assembled — see index.ts:1-81) using whatever tool-override hook pi v0.62+ exposes (likely `pi.overrideTool` or a `tool_call` hook in `src/hooks/`, next to the existing `src/hooks/context.ts` and `src/hooks/resources.ts`).
- Diagnostics path: `didOpen`/`didChange` → `compile_diagnostics` (sema-lsp/src/server.rs:799-841), returned as LSP `PublishDiagnostics` notifications — the client needs a notification listener, not just request/response (a gap in the current `JsonRpcClient`, which per `src/bridge/jsonrpc.ts` is built around request/response `mcpCallTool`/`mcpListTools`).
- Forge integration: `src/forge/forge.ts`'s pipeline (forge.ts:81-103, the `verifyToolSource` call) gains a step 0 — LSP diagnostics on the candidate source — before the strict-sandbox spawn, short-circuiting on syntax errors with the exact same `describeProbeFailure`-shaped message the model already expects.
- Scope: only `.sema` files under the current `cwd`; the sidecar is keyed to `ctx.cwd` the same way `SemaBridge.start(cwd, …)` is (bridge.ts:85).

## Grounding & prior art
LSP push-diagnostics-on-didOpen insight (compiler-grade validation without execution), pi tool-override extensibility insight, agent-lsp in-memory-edit-then-commit pattern, forge pre-flight relevance note.

## Effort & risks
Effort: **M**
- **Risk: pi's tool-override API may not support wrapping built-in `edit`/`write` cleanly** (vs. only registering new tools, which is all pi-sema does today). Mitigation: spike the override API in isolation first; if unsupported, fall back to a `tool_call` post-hook that runs diagnostics *after* the edit lands and offers a one-key revert, rather than gating pre-commit.
- **Risk: LSP sidecar doubles the sema child-process surface** (mcp + lsp), doubling crash/restart complexity. Mitigation: factor the shared spawn/restart/JSON-RPC-framing logic out of `McpProcess` into a common base so `lsp.ts` isn't a copy-paste fork.
- **Risk: notification-based diagnostics don't fit the existing request/response `JsonRpcClient`.** Mitigation: extend `JsonRpcClient` with a notification dispatch table (method → handlers) rather than building a parallel client type.

## Open questions
- Does pi v0.62+'s tool-override actually let an extension intercept-and-modify-result for *built-in* tools, or only register net-new ones?
- Should the gate be blocking (refuse to commit the edit on errors) or advisory (commit + append diagnostics)? The pitch assumes advisory for turn efficiency.
- Multi-file diagnostics (an edit that breaks a *different* file via a shared symbol) — does `compile_diagnostics` scope per-file only, or does it need `ScanWorkspace` context first?
