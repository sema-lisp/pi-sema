# Burn-Rate Horizon: predictive budget depletion with degrade menu
> Project the budget curve forward and offer a graceful-degradation menu before a run busts its cap, instead of stalling mid-flight.

## Why (the non-obvious insight)
`sema-workflow`'s journal already emits `budget` events on every priced LLM call (`src/workflows/model.ts` folds `input_tokens`/`output_tokens`/`cost_usd`/`budget_limit` into `RunState.budget`), and pi-sema already streams that state live via `JournalTailer`. Nobody projects it forward. Every other harness treats budget as a hard stop the agent discovers by crashing into it. But a run's burn rate is a time series available *before* the overrun — cost-per-step is usually near-stationary within a phase, so a simple regression over recent `budget` events plus remaining declared phases/steps (`RunState.phases`, `src/workflows/model.ts`) predicts the bust several steps ahead. The fix isn't a bigger warning, it's a menu of real, already-implemented degradation levers (cheaper model, drop scope, read-only mode) instead of one binary kill switch — because the only two options today (finish or die) waste everything already spent when the correct move is usually "spend less on what's left."

## How it works (user-visible behavior, step by step)
1. User runs `sema_workflow_run` on a multi-phase workflow with a `:budget` cap (or a configured `workflows.defaultBudgetUsd`).
2. As journal events stream in, the dashboard footer widget (already set via `ctx.ui.setWidget` in `registerWorkflowRunTool`) grows a small burn sparkline: tokens/cost per step, extrapolated to a "steps remaining" estimate from `state.phases`.
3. When projected total cost crosses ~85% of `budget.limit` *before* the run actually gets there, pi-sema pauses at the next safe checkpoint (a `checkpoint` journal event boundary) and opens a `ctx.ui.select` overlay: "Projected to exceed budget by $X in ~N steps. [Switch remaining steps to cheap model] [Drop lowest-priority phases] [Continue read-only (no more edit/write tool calls)] [Continue anyway] [Abort]".
4. Whichever choice is made maps to a concrete, already-available mechanism (see Architecture) and the run resumes via the existing `--resume <run_id>` path, so nothing already paid for is lost.
5. If the user is away (non-interactive / headless), a config default policy (e.g. "auto-degrade to cheap model") applies automatically and is logged as a journal-adjacent decision so it's visible in the dashboard afterward.

## Architecture (files touched)
- `src/workflows/runner.ts`: `runWorkflow()`'s `onState` callback is the natural hook point — after each `reduceRun`, compute `projectedCost = costUsd + burnRate * stepsRemaining` and compare to `state.budget.limit`. New pure function `projectBurn(state: RunState, history: BudgetSample[]): BurnProjection` alongside `model.ts`.
- `src/workflows/model.ts`: extend `RunState` (or a companion struct) to retain a short rolling window of `budget` events with timestamps for the regression instead of only the running total — currently `reduceRun` only accumulates, it doesn't retain history.
- New `src/workflows/burn.ts`: houses `projectBurn`, threshold logic, and the degrade-menu → mechanism mapping.
- Intervention overlay: `ctx.ui.select` from within the tool's `execute` (mirrors the existing `ctx.ui.confirm`/`ctx.ui.select` usage pattern already established in `src/forge/forge.ts`).
- Mechanism wiring for each menu choice:
  - "cheap model" → pi's model-switching API (extension surface, not yet used elsewhere in pi-sema — new integration point) applied to subsequent `agent.started` events for the remainder of the run.
  - "drop scope" → edits the workflow's `args`/declared phases before the `--resume` relaunch (workflow model in `src/workflows/model.ts` / the `.sema` workflow source resolved via `LibraryStore`).
  - "read-only" → a pi `tool_call` hook (extension API, new) that blocks `edit`/`write`-class tools for the remainder of the run.
- Dashboard: `src/ui/dashboard.ts` `renderDetail()` already prints budget-adjacent state (`Duration`, `Checkpoints`); add a burn sparkline line fed by the same `projectBurn` used by the live tool, so the dashboard and the live warning agree on one calculation.
- Data flow: `sema workflow run` (Rust) → `events.jsonl` (`budget` events) → `JournalTailer` → `reduceRun`/`projectBurn` → `onState` → tool `onUpdate` + `ctx.ui.setWidget` + (crossing horizon) `ctx.ui.select`.

## Grounding & prior art
Workflow-level projected-depletion insight (cf. Bolt.new's reported $1000 runaway burn incidents — the postmortem lesson being that hard stops without projection waste sunk cost); risk-stratified capability-degradation insight (graceful reduction beats binary kill); cost-optimized model-split insight (send only the tail of a run to a cheaper model once quality-critical steps are already paid for); tab-status zero-context-footer pattern (the sparkline costs zero LLM context, it's host-side bookkeeping only, matching pi-sema's existing `ctx.ui.setWidget` footer usage).

## Effort & risks
Effort: **M**

1. **Regression is noisy on short runs.** Cost-per-step varies wildly across phases (a cheap tool-call phase vs. an LLM-heavy phase). Mitigation: key the burn rate to *phase*, not the whole run — `RunState.phases` already segments this; regress within the current phase and use declared phase count only as a rough remaining-steps prior, with wide confidence bands that suppress the warning under low sample counts (same n-gating discipline as the ROI ledger idea).
2. **Interrupting a run mid-phase for the menu could break workflows with side effects that assume uninterrupted execution.** Mitigation: only pause at `checkpoint` event boundaries (already a first-class journal event workflows opt into), never mid-tool-call; if a workflow declares no checkpoints, degrade to end-of-phase pauses only.
3. **Model-switching and read-only enforcement are not yet integration points pi-sema uses anywhere.** Mitigation: land "abort with clear message" and "continue anyway" first (zero new API surface, pure journal math), then add the cheap-model and read-only levers behind a feature flag once the pi extension APIs are confirmed stable.

## Open questions
- Does pi's extension API expose a supported "switch model for remaining steps of an already-running agent" call, or does that require killing and relaunching the `sema mcp`/workflow agent with a different model arg?
- Should the horizon threshold (85%) be configurable per-workflow via `:budget` metadata in the `.sema` source, or only via `PiSemaConfig.workflows`?
- For non-interactive runs, what's the safe default policy — abort, or auto-degrade? Silent auto-degrade risks surprising quality regressions the user never asked for.
