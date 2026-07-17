# Crash Autopsy: auto post-mortem under break-on-uncaught
> When a sandbox run throws, don't hand the agent a stack-trace string — relaunch it under `sema dap` and land the agent AT the crash frame with live locals.

## Why (the non-obvious insight)
Today a failing forge probe or workflow step gives the agent a flattened error string, and the agent's only lever is "read the trace, guess, rewrite the whole file, rerun." That's expensive (a full sandbox re-execution per hypothesis) and lossy (locals, call depth, and the exact throw site are gone). Sema ships a real DAP server (`sema-dap`) with `setExceptionBreakpoints`, `evaluate`, and even `set!`-capable in-frame mutation — the same machinery a human would reach for, but no harness wires it into an agent loop. The prior-art trap is exposing that DAP surface as raw step/next/continue tools: InspectCoder's finding is that fine-grained debugger REPLs corrupt agent state (the model loses track of *where* it is across dozens of tool calls). The fix is ChatDBG's move: bound the whole post-mortem to one coarse `autopsy` tool that hands back an enriched snapshot, not a debugger session to drive turn by turn.

## How it works (user-visible behavior, step by step)
1. A `create_sema_tool` probe (or a `sema_run_file`/workflow step) exits non-zero.
2. Instead of just returning stderr, pi-sema silently relaunches the same program under `sema dap` with `setExceptionBreakpoints: ["uncaught"]`.
3. The process re-runs (deterministically, same inputs) and stops at the real throw site.
4. The agent receives one tool result: `autopsy` — source window around the frame, typed locals, call stack summary, and the original error text.
5. The agent can call `debug_eval(frame, expr)` to test a hypothesis ("what's the shape of `x`?") or `debug_set(var, value)` to patch a binding and `continue`, watching whether the crash recurs.
6. A bounded iteration cap (e.g. 5 eval/set rounds) forces a verdict; the agent returns a root-cause summary to the main session instead of staying in a debug sub-loop forever.

## Architecture
- New module `src/forge/autopsy.ts` (sibling to `src/forge/probe.ts`), used first from the forge probe failure path in `src/forge/forge.ts` (`if (!probe.ok) { … }` around forge.ts:91) and later reusable from `src/workflows/runner.ts` step-failure handling.
- Spawns `sema dap` as a child process the same way `src/bridge/process.ts`'s `McpProcess` spawns `sema mcp` — stdio pipes, but framed with DAP's `Content-Length` headers instead of bare JSON-RPC lines, so `src/bridge/jsonrpc.ts` needs a sibling `dapClient` (Content-Length framing is a small variant of the existing `JsonRpcClient`).
- Sequence: `initialize` → `launch` (server.rs:184, launch-only — pi owns the process lifecycle it already owns for probe/sandbox runs) → `setExceptionBreakpoints` (server.rs:278) → wait for `stopped` event → `stackTrace`/`scopes`/`variables` (server.rs:339-524) → build the autopsy snapshot.
- Because `(load ...)`/`(import ...)`'d code isn't debuggable (sema-dap/src/lib.rs:3-17), autopsy generates a self-contained harness file (deftool source + a driver call) in a scratch dir under `.sema/` rather than pointing DAP at the original multi-file source — mirroring how `verifyToolSource` in `src/forge/probe.ts` already builds a synthetic eval buffer.
- Exposes exactly two new pi tools registered from `src/forge/autopsy.ts`: `debug_eval(frame, expr)` → DAP `evaluate` (server.rs:339-524), and `debug_set(var, value)` → `evaluate` of a `set!` form in the paused frame (vm.rs:4312/4427). No `next`/`step`/`continue` tool is exposed to the model — continuation between rounds is host-driven.
- Rendered as a compact TUI block via `onUpdate`/`ctx.ui.setWidget`, matching the pattern `src/workflows/runner.ts` uses for its run-status widget (runner.ts:157-165).

## Grounding & prior art
DAP insights (setExceptionBreakpoints/exceptionInfo end-to-end, evaluate-in-paused-frame with set! writeback, launch pipeline seeds full stdlib+LLM env, load/import non-debuggable limitation), InspectCoder "raw debugger REPLs corrupt agent state", ChatDBG "take the wheel" bounded sub-loop + enriched frame context, break-loop/condition-system Lisp heritage insight.

## Effort & risks
Effort: **L**
- **Risk: harness fidelity.** A synthetically inlined driver may not reproduce the exact failure (different call site, missing outer state). Mitigation: reuse the identical stdin buffer the probe already constructs (`verifyToolSource`'s source + suffix), just launched under `sema dap` instead of `sema eval`, so the two paths never diverge.
- **Risk: DAP process leaks.** A crashed/hung `sema dap` child could pile up across many probe failures. Mitigation: one-shot child per autopsy call, hard-killed on the same 2s SIGTERM→SIGKILL escalation `spawnSema` already implements, no long-lived DAP session.
- **Risk: token blowup from raw variable dumps.** Large locals (embeddings, big lists) could flood context. Mitigation: apply the same structure-preserving preview/size cap idea as the envelope module (`src/envelope.ts`) to the DAP `variables` response before it reaches the model.

## Open questions
- Should autopsy be opt-in per forge/workflow config, or automatic on every non-zero exit?
- How does the iteration cap interact with pi's own tool-call budget — separate counter or shared?
- Can the harness-generation logic be shared verbatim with idea 02 (Bug Capsules), which needs the same "make code debuggable" step but for cassette-driven runs?
