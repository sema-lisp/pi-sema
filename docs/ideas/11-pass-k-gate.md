# Pass^k Gate: reliability replays before a tool earns its tier
> One green run doesn't make a reliable tool — replay it k times and print the confidence badge on every library entry.

## Why (the non-obvious insight)

`src/forge/probe.ts` already runs exactly one verification pass — `verifyToolSource` evaluates the candidate under `--sandbox strict --no-llm` and asserts `(tool? name)`, once. That's pass@1, and the τ-Bench finding pi-sema's own grounding cites is that pass@1 hides a pass^8 collapse (50%→25% is typical for agentic tools with any LLM-dependent or stateful behavior). The reason pi-sema can afford k replays where a naive agent can't is structural: Sema's tool execution is deterministic-by-default under strict sandbox (no network/shell/fs-write, `--no-llm` denies model calls entirely), and where LLM calls *are* the point (a forged tool that itself calls a model), cassette record/replay makes repeat evaluation cheap and reproducible — no new API spend, no flakiness from the LLM provider itself. The gap is that `forge.ts`'s single `probe.ok` check treats "compiled and registered" as "reliable," then persists straight to the live tier (`store.save` at `forge.ts:131`) with no further evidence.

## How it works (user-visible behavior, step by step)

1. Agent calls `create_sema_tool`. Stage 1 (existing) is unchanged: strict-sandbox probe, `(tool? name)` assertion.
2. New Stage 1.5: on first success, run k=5 replays against a small generated input set (varying arguments, not the source) — first run discarded as warm-up (JIT/cache effects), remaining 4-5 scored.
3. Approval overlay (the existing `ctx.ui.confirm` text) gains a line: `"pass^5: 5/5, CV 3% — high confidence"` or `"pass^5: 3/5 — quarantined, will not auto-run without explicit approval each call."`
4. Below-threshold tools still get stored (so the work isn't lost) but land in a `quarantine` tier flag distinct from `project`/`global` — visible in the dashboard (`ui/dashboard.ts`) as a badge, with a one-key "re-forge with higher effort" action that re-invokes `create_sema_tool` with a stronger prompt (routes through `forge/prompts.ts`'s `CREATE_TOOL_GUIDELINES`).
5. The same k-replay machinery is exposed as a standalone dashboard "reliability check" button for existing library tools/workflows (not just new ones), and its variance output feeds idea 5 (Tool ROI Ledger) so a tool's dashboard entry shows cost *and* confidence side by side.

## Architecture (real modules)

- **`src/forge/probe.ts`** — extend `verifyToolSource` (or add `verifyToolReliability`) to loop the existing `spawnSema(["eval", "--stdin", "--json", "--sandbox", "strict", "--no-llm"], ...)` call k times with varied probe suffixes (different generated argument sets appended after the `(if (tool? name) ...)` check), collecting `elapsedMs` and pass/fail per run for CV.
- **`src/forge/forge.ts`** — Stage 1 (`onUpdate?.({stage: "probe"})`) grows a Stage "reliability" between probe and the human-approval gate (line ~105); `cfg.forge` (`src/config.ts`) needs new knobs: `replayCount`, `passKThreshold`.
- **`src/library/store.ts`** — `LibraryEntry`/`save` need a `quarantine` marker; simplest is a sidecar (`<name>.sema.meta.json` next to the `.sema` file, or a frontmatter comment) recording `{passK: "5/5", cv: 0.03, tier: "quarantine"}` — `scanKind`'s walk (line 105) would need to read it alongside the `.sema` file.
- **`src/ui/dashboard.ts`** — `DashboardComponent` currently renders run state only; a reliability badge column requires reading the library (not just `.sema/runs/`) — a new list-mode alongside the existing list/detail toggle, or a dashboard section reusing `formatRunSummary`-style formatting from `ui/format.ts`.
- **Input generation** — for tools with typed params (`sanitizeSchema` output already carries JSON Schema), a lightweight fuzzer can generate k varied argument sets from the schema's `properties` types; for tools with no meaningful param variation, replay the same call k times (still catches LLM-call nondeterminism via cassette variance).
- **Cassette machinery** — referenced in the idea's grounding but not present in `src/` today; this assumes idea's own infra (record/replay for LLM calls) exists or is built alongside — likely lives in `forge/` or a new `src/replay/` module, gating `--no-llm` replacement with a cassette-backed LLM stub.

## Grounding & prior art

Pass^k reliability widget insight (τ-Bench); warm-up + coefficient-of-variation statistical rigor insight; Voyager/SkillsBench deterministic-verification requirement; cassette record/replay cheapness.

## Effort & risks

**Effort: M**

1. **k replays multiply forge latency** — `cfg.forge.probeTimeoutMs` is already a per-attempt budget; 5x that is a real wait during `create_sema_tool`. Mitigation: run replays in parallel (separate `spawnSema` child processes, no shared state under strict sandbox) rather than serially.
2. **CV is meaningless for pure functions** — a tool with zero LLM calls and no environmental dependency will pass 5/5 with 0% variance trivially, adding overhead without signal. Mitigation: skip Stage 1.5 (or run k=1) when static analysis of the source shows no `llm/*` or nondeterministic stdlib calls — cheap to detect via the same `collectNamespacedSymbols` regex `probe.ts` already has (line 80-92).
3. **Quarantine UX friction** — a legitimately-reliable tool that fails 2/5 for a real bug (not flakiness) needs a clear diagnostic, not just a badge. Mitigation: surface the *which* runs failed and their `describeProbeFailure` output (already exists) alongside the pass^k score, not just the ratio.

## Open questions

- Does Sema have (or need) a cassette/record-replay layer for `llm/*` calls today, or is this idea's k-replay scoped to only deterministic tools until that lands?
- Should pass^k re-run automatically on every `sema mcp` restart (drift detection) or only at forge time?
- What's the right default k and threshold — is 5/5 too strict for tools with intentional randomness (e.g. sampling)?
