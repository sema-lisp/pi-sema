# Break-Loop Restarts

> Workflow step errors suspend instead of fail — the agent or user chooses continue-with-patch, redefine-and-retry, or abort, Lisp Machine style.

## Why (the non-obvious insight)

Every current failure path in pi-sema treats an error as terminal-for-the-step: `runWorkflow` in `workflows/runner.ts` sets `state.status = "failed"` on a killed process, and `finalResult` tells the agent to retry the _whole run_ via `resume=<run_id>` (memoized steps replay for free, but the failing step itself just reruns from scratch). That's the Unix-exception model — unwind and restart. Lisp Machines (and Common Lisp's condition system generally) offer a different move that no agent harness currently exploits: freeze the stack _at_ the error, inspect and mutate live state, and resume the same computation. Sema already has the primitive that makes this real rather than aspirational — `sema dap` supports `setExceptionBreakpoints` with an `'uncaught'` filter and `evaluate`/`set!` writeback into a paused frame (`server.rs:876` `break_on_uncaught`, `vm.rs:4312` `debug_evaluate_mut`). Wiring workflow step execution through DAP-with-break-on-uncaught turns "retry from scratch" from the _only_ option into the _last-resort_ option.

## How it works (user-visible behavior, step by step)

1. A workflow step body runs under `sema dap` with `break_on_uncaught` permanently enabled instead of plain `sema workflow run` step execution.
2. On an uncaught exception, the step doesn't fail — `runner.ts` records a `"suspended"` journal event (a new event kind alongside the existing `budget`/`phase`/etc. vocabulary read by `workflows/model.ts`'s `reduceRun`).
3. The user (or the agent, if unattended) is presented a `ctx.ui.select` overlay with three choices, surfaced through the same widget mechanism `runner.ts` already uses (`ctx.ui.setWidget`, `formatRunLines`):
   - **Continue with patched value**: `debug_evaluate_mut` a `(set! x v)` in the paused frame, then continue.
   - **Redefine and retry**: evaluate a new `(defn ...)` in-frame, then re-invoke the frame that threw.
   - **Abort**: disconnect DAP, mark the step genuinely failed (today's behavior).
4. A suspended run persists its harness file + breakpoint state in the run directory, so it's resumable across pi sessions exactly like today's `resume=<run_id>` path — except resuming a suspension re-attaches DAP instead of re-running from the top of the step.
5. Budget events (`workflows/model.ts:138-145`) keep accruing while suspended, so a suspension sitting near the budget limit still trips the depletion warning rather than silently stalling forever.

## Architecture (which pi-sema modules touched/added; which pi extension APIs; which sema features/CLI/LSP/DAP requests; data flow)

- **`src/workflows/runner.ts`** — `runWorkflow` currently spawns `sema workflow run ...` via `spawnSema` and tails the journal. This idea requires an alternate execution path: spawn `sema dap` instead (or have `sema workflow run` itself launch steps under DAP — whichever the sema CLI supports), drive the DAP protocol (initialize → launch → setExceptionBreakpoints "uncaught" → on stop: stackTrace/scopes/variables/evaluate), reusing the Content-Length JSON-RPC framing already implemented for MCP in `src/bridge/jsonrpc.ts` as the pattern (a DAP variant would live in a new `src/bridge/dap.ts` since `jsonrpc.ts` is MCP-shaped, not DAP-shaped).
- **`src/workflows/model.ts`** — extend `RunState`/`JournalEvent` handling with a `"suspended"` status and the restart-choice metadata (frame locals preview, source window) needed to render the select overlay.
- **`src/workflows/journal.ts`** — no format change needed; `JournalTailer` already tails arbitrary `{event, seq, ts, ...}` lines, so a new `event: "step.suspended"` line flows through unchanged.
- **New UI surface**: a `ctx.ui.select` overlay (pi extension API) invoked from `runner.ts`'s `onState` callback when `state.status === "suspended"`, offering the three restart choices; wired similarly to how `finalResult` already special-cases `needs-auth`.
- **Data flow**: `sema dap` process (launched per-step) → stop event on uncaught exception → runner captures frame snapshot via `stackTrace`/`variables` → journal `"suspended"` event → dashboard/tool-result overlay → user/agent choice → `evaluate`/`set!` or redefine via DAP → `continue` request → step resumes in the SAME process, not a new one.

## Grounding & prior art

Image-based systems / break-loop insight (Genera, Interlisp restarts); evaluate-in-paused-frame `set!` writeback insight; journaled/resumable workflow infrastructure; condition-system-vs-exception-unwinding differentiator note.

## Effort & risks

Effort: **XL**

1. **DAP-driven step execution is a fundamentally different runtime path than today's `sema workflow run`** — steps may not currently be individually DAP-launchable, and `(load ...)/(import ...)` code is explicitly NOT debuggable per `sema-dap/src/lib.rs`, which could exclude exactly the multi-file workflows this is meant to rescue. Mitigation: scope v1 to single-file/inline step bodies only, matching the same harness-inlining workaround used by the Crash Autopsy idea.
2. **Unattended runs have nobody to answer the restart prompt.** Mitigation: define a policy default (e.g. auto-abort after N seconds, or auto-continue-with-nil) for non-interactive contexts, surfaced via workflow `:budget`-style metadata.
3. **Suspended state held across pi sessions requires the DAP process (or its resumability) to survive a session boundary**, which no existing pi-sema subprocess does — `McpProcess` is explicitly "never restarted mid-session." Mitigation: persist enough state (harness file, breakpoint spec, patched bindings) to _relaunch_ a fresh `sema dap` and fast-forward via cassette replay rather than keeping the OS process alive across sessions.

## Open questions

- Can `sema workflow run` steps be launched individually under `sema dap`, or does this require a new sema CLI mode that runs a single step in isolation?
- What happens to steps _downstream_ of a suspended one — do they block, or does the workflow DAG need to expose partial progress while one branch is paused?
- Is "redefine and retry the frame" well-defined when the redefinition changes the function's arity or the frame's captured closure — does sema's DAP support re-entering a frame with a structurally different function?
