# Bug Capsules: cassette-pinned deterministic debug replays

> Freeze a failing workflow step — source, LLM cassette, and breakpoint spec — into a sealed artifact the agent can rewind for free, as many times as it needs.

## Why (the non-obvious insight)

Workflow steps that call `(llm ...)` are the hardest thing to debug interactively: re-running to reproduce a failure re-spends real tokens and risks a different model response the second time. Sema's cassette record/replay (already used for workflow tests) makes LLM calls deterministic and free to replay. Nobody has fused that with the DAP server: a "bug capsule" is source + cassette + breakpoint spec bundled together, so stepping through _including the moment right before an LLM call_ — to inspect the exact prompt that was built — costs zero tokens and is bit-for-bit reproducible. This turns "prove the fix" from agent self-report into a mechanical diff: replay the capsule, check whether the crash signature is gone.

## How it works (user-visible behavior, step by step)

1. A workflow run (`sema_workflow_run`) fails on some step; `src/workflows/runner.ts` already has the journal and cassette path for that run.
2. On failure, a capsule is written: `{ sourceFiles, cassettePath, failingStepId, env }`, recorded as a journal-adjacent artifact (e.g. `.sema/runs/<runId>/capsule.json`).
3. The agent calls `debug_capsule(runId)`. This launches `sema dap` on a generated harness that runs the failing step with cassette replay enabled, and a breakpoint set on the line _before_ the `llm` call (or the throw site).
4. The agent inspects the paused frame — including the fully-rendered prompt about to be sent — using the same coarse `debug_eval`/`debug_set` tools as Crash Autopsy (idea 01).
5. After editing the tool/workflow source, the agent replays the capsule again; pi-sema diffs exit code + exception signature against the original capsule and reports pass/fail — not the agent's opinion of whether it's fixed.

## Architecture

- New module `src/forge/capsule.ts` (or `src/workflows/capsule.ts`, sitting next to `src/workflows/journal.ts`), triggered from the failure branch already present in `runWorkflow` (`src/workflows/runner.ts`, around the `state.status !== "success"` check at runner.ts:207).
- Capsule write reuses the run directory layout `JournalTailer` already understands (`src/workflows/journal.ts` — `events.jsonl` + `events.resume-N.jsonl`), adding one more file (`capsule.json`) beside `result.json`.
- Launch path is the same DAP client introduced for Crash Autopsy (`initialize` → `launch` → `setExceptionBreakpoints`/explicit line breakpoint via `valid_breakpoint_lines` snapping, server.rs:866-868) — but critically, `launch` seeds the _full_ `sema_eval::Interpreter` env including LLM primitives (server.rs:813-900), and cassette-replay mode is passed through the same env/args `spawnSema` already threads for workflow runs (`SEMA_WORKFLOW_RUN_ID`, cassette path likely via an existing `--cassette`/env var used by workflow tests — confirm the exact flag in the sema CLI before implementing).
- New pi tool `debug_capsule(id)` in `src/forge/autopsy.ts` (shared with idea 01) or a new `src/forge/capsule.ts`; reuses `debug_eval`/`debug_set`.
- Fix verification is a second capsule replay compared against the first by exit code + exception signature, recorded back into the journal via `pi.appendEntry` (the same call `src/forge/forge.ts` uses at forge.ts:157) so the "proof of fix" is durable, not just a chat message.

## Grounding & prior art

"Bug capsules" rr/time-travel insight, DAP launch-runs-real-pipeline-with-LLM-primitives insight, cassette-based regression testing insight, verifiable-fix loop ("reproduce, measure, change one variable, verify").

## Effort & risks

Effort: **L**

- **Risk: cassette/DAP interaction is unverified.** It's not confirmed that `sema dap`'s `launch` pipeline accepts the same cassette-replay flag/env as `sema workflow run`. Mitigation: spike this first as a standalone check before building the capsule format around it — if unsupported, fall back to non-DAP capsule replay (just `sema workflow run --resume` + cassette) and layer DAP breakpoints in a follow-up.
- **Risk: capsule staleness.** If the workflow source changes between capture and replay, the capsule's breakpoint line numbers drift. Mitigation: snapshot source files into the capsule dir (small `.sema` files, cheap) rather than referencing live paths, so a capsule is truly sealed.
- **Risk: false "fixed" verdicts from signature-only diffing.** Same exception class at a different line could look like a pass. Mitigation: compare stack frame + line, not just exception message.

## Open questions

- Does `sema workflow run` expose cassette path/mode as a stable CLI flag today, or is it internal to the test harness only?
- Should capsules auto-expire (disk growth under `.sema/runs/`), and does that conflict with `jake sweep`-style cleanup conventions?
- Can a capsule be shared across machines (teammate reproduces your exact failure) or is it inherently local-path-bound?
