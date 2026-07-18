# Workflow Rewind & Branch Explorer

> Rewind a journaled workflow run to step N, edit what the agent believed, and fork a new branch — replaying prior LLM calls from cassette at near-zero cost.

## Why (the non-obvious insight)

Pi-sema's workflow journal is already append-only and resumable (`src/workflows/journal.ts`'s `JournalTailer`, `src/workflows/runner.ts`'s `resume` flag) — that infrastructure was built for "replay completed steps for free after a crash," but nobody has generalized it to "replay completed steps for free after a _deliberate edit_." Debugging an agent workflow today means re-running the whole thing and hoping the divergence you care about shows up again. Because Sema's cassette system already makes LLM calls deterministic, forking at step N and changing one input (a tool result, a goal string) costs nothing for steps 0..N and only spends tokens past the fork point — turning "did that intermediate decision matter?" into a cheap, answerable experiment instead of a hypothesis.

## How it works (user-visible behavior, step by step)

1. User opens the dashboard (`src/ui/dashboard.ts`'s `registerDashboard`, already listing runs via `listRuns`).
2. A run's step list is shown as a DAG instead of a flat log; each past step has a "fork from here" action.
3. Selecting fork-from-step-N prompts for a patch: edit the goal text, a tool result, or a model choice recorded at that step.
4. pi-sema truncates a _copy_ of the journal at step N, applies the patch, and launches a new run with `parent`/`fork` metadata pointing at the original run.
5. Steps before the fork replay from the cassette (no LLM spend); steps after the fork run live, spending real tokens only from the divergence point forward.
6. The dashboard renders both branches side by side; the budget widget shows only the _incremental_ (post-fork) cost per branch, so comparing five counterfactuals doesn't look like five full runs.

## Architecture

- Core new logic in `src/workflows/journal.ts`: a `forkJournal(runDir, atStep, patch): newRunDir` that copies `events.jsonl` up to the event boundary for step N into a new run dir, mirroring how `events.resume-N.jsonl` segments are already ordered and read by `JournalTailer.segmentFiles()` (journal.ts:85-102) — a fork is structurally like a resume segment but with a patched event instead of a verbatim continuation.
- `src/workflows/runner.ts`'s `runWorkflow` already takes `resume` (a run id) and passes `--resume <id>` to `sema workflow run` (runner.ts:63-90); forking needs a new `sema` CLI capability (or a documented existing one) to resume-with-override, since plain `--resume` replays verbatim. If `sema workflow run` has no "resume with a patched step" flag, this is a **blocking dependency on the sema CLI**, not purely pi-sema work.
- `src/workflows/model.ts`'s `newRunState`/`reduceRun` fold engine needs a `parentRunId`/`forkedAtStep` field threaded through `RunState` so the dashboard can render ancestry.
- UI: `src/ui/dashboard.ts`'s `DashboardComponent` (opened via `ctx.ui.custom` with `overlay: true`, dashboard.ts:74-80) gains a DAG pane — reusing the existing `formatRunLines`/`formatRunSummary` (`src/ui/format.ts`) per node, plus a new tree-layout renderer. `renderShell: "self"` (per pi's custom-overlay API) keeps multi-line layout stable as the DAG grows.
- Budget accounting: `src/workflows/model.ts`'s event reducer already tracks budget events per run; incremental-cost display for a fork is `reduceRun` starting its accumulator at the fork point rather than zero, which is a small change to the reducer's initial state, not a new subsystem.

## Grounding & prior art

AgentGit/LangGraph time-travel checkpoint insight ("validated precedent... reusing existing journal infra"), Branching Tree Explorer insight, cassette-backed deterministic resume insight (differentiator vs pi-dynamic-workflows), Tree-of-Thoughts branching.

## Effort & risks

Effort: **L**

- **Risk: `sema workflow run --resume` may only support verbatim replay, not patched-step resume.** This is the load-bearing risk — without CLI support for injecting a state edit at a resume point, "fork with a patch" degrades to "just resume, no edit." Mitigation: prototype against the plain resume path first (fork = copy + resume, no patch) to validate the journal-copy mechanics, then negotiate the patched-resume CLI flag as a sema-side feature request.
- **Risk: journal copy semantics under concurrent runs.** Forking a _live_ run's journal mid-write could race the tailer. Mitigation: only allow forking from completed/failed runs initially (dashboard already distinguishes `live` via `RunListing.live`, dashboard.ts:48), add live-fork later if needed.
- **Risk: DAG UI complexity in a TUI overlay.** Tree layouts in fixed-width terminal panes get cramped past ~5 branches. Mitigation: start with a flat "branches of run X" list view (already close to `listRuns`' existing sort) and add graph rendering only once multi-level forking is common.

## Open questions

- Does the sema CLI (`sema workflow run`) have any existing primitive for resuming with a modified step, or does this require upstream sema work first?
- What counts as a "patchable" step value — only scalar args, or also large tool results (which raises the same size questions as idea 10, Live Value Bindings)?
- Should forked runs count against the same budget ledger as their parent, or get independent budgets?
