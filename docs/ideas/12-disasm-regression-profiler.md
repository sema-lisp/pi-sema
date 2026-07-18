# Disasm Regression Profiler for forged tools

> A forged tool that "still passes tests" but tripled its instruction count is a timeout waiting to happen — catch it at the bytecode level, for free.

## Why (the non-obvious insight)

`sema compile` (source → `.semac`) and `sema disasm --json <file.semac>` are real, existing subcommands (`crates/sema/src/main.rs:783`, `run_disasm`/`disassemble_to_json`) that do pure static compilation — no execution, no LLM, no tokens. pi-sema's current forge pipeline (`src/forge/forge.ts` + `src/forge/probe.ts`) verifies _behavior_ (does it register, does it not crash under `--sandbox strict --no-llm`) but has zero visibility into _shape_: a tool re-forged by the model to "fix a bug" can pass the exact same probe while silently growing 3x in call depth or losing an exception handler — the kind of regression that shows up three weeks later as a mysterious timeout, not a test failure. Because disassembly is compile-only, this check is nearly free to run on every single forge — cheaper than the strict-sandbox probe that already runs, since it doesn't even need to _evaluate_ the candidate, just compile it.

## How it works (user-visible behavior, step by step)

1. Agent calls `create_sema_tool` with new/updated source for an existing tool `pdf-extract`.
2. Alongside the existing Stage 1 probe (`verifyToolSource`), a new Stage 1.6 compiles both the candidate source and the on-disk baseline (`store.resolve("tools", name)` — already computed in `forge.ts` for the `existed` check) to `.semac` via `sema compile`, then runs `sema disasm --json` on each.
3. Both JSON listings are reduced to a metric vector: instruction count, max call depth (from chunk/function nesting), allocation-op count (opcodes touching heap alloc), exception-handler span coverage.
4. Metrics are diffed. If any crosses a configured threshold, the approval overlay (`ctx.ui.confirm` in `forge.ts:107-110`) gains a line: `"⚠ call depth 4→19 (recursion risk), instructions 340→1120 (3.3x)"`.
5. The human sees this before approving, same gate as today — no new prompt, no new step, just richer information at the existing one.
6. Metrics persist per tool version in the library store, so the dashboard (idea 4's ROI ledger) can show a complexity trend line, and idea 10's Pass^k Gate can route high-complexity tools away from time-tight budgeted runs (deprioritized in scheduling, not blocked).

## Architecture (real modules)

- **`src/forge/probe.ts`** — sibling function `profileToolBytecode(source, baselineSource, opts)` next to `verifyToolSource`; both call `spawnSema` (`src/sema.ts`) but with `["compile", "--stdin", ...]` then `["disasm", "--json", tmpPath]` — note `disasm` takes a _file path_, not stdin (per `run_disasm`'s `std::fs::read(file)`), so this needs a scratch `.semac` write (e.g. under `paths.ts`'s tier root or `os.tmpdir()`), unlike the stdin-piped probe.
- **`src/forge/forge.ts`** — new stage between the existing probe (Stage 1, `onUpdate?.({stage: "probe"})`) and the human-approval gate (line ~105); needs the _baseline_ source, which `forge.ts` already has implicitly via `existed`/`targetPath` (line 129-130) — just needs `store.read()` before the overwrite happens at `store.save()` (line 131).
- **`src/library/store.ts`** — metric vectors need a place to live per version; simplest is extending the same sidecar metadata file idea 10 (Pass^k Gate) also wants (`<name>.sema.meta.json`), keeping one small schema evolution instead of two competing ones — worth designing these two ideas' metadata format together if both ship.
- **`src/config.ts`** — new `cfg.forge` knobs: threshold ratios for instruction-count growth, call-depth absolute cap, allocation-op growth.
- **Routing/scheduling hook** — "high-complexity tools deprioritized for time-tight budgeted runs" implies the workflow runner (`src/workflows/runner.ts`) or budget-aware scheduling (idea 12, Burn-Rate Horizon) reads the same per-tool metric vector at dispatch time — a read-only consumer of the sidecar file, no new write path.
- **Data flow**: candidate source + baseline source → two `sema compile` calls → two `sema disasm --json` calls → metric vectors → diff → approval overlay text + persisted metrics.

## Grounding & prior art

Sema-aware bytecode profiling insight; tool versioning + regression detection insight; timeout/complexity-injection hidden failure mode insight; anti-pattern detection heuristics insight.

## Effort & risks

**Effort: M**

1. **`disasm` needs a file, not stdin** — unlike `probe.ts`'s stdin-piped verification, this requires writing scratch `.semac` files and cleaning them up; a crash or abort mid-forge could leak temp files. Mitigation: write under a session-scoped temp dir, clean up in a `finally`, and don't block forge completion on cleanup failure.
2. **Metric thresholds are arbitrary until calibrated** — "3x instruction growth" sounds dangerous but a tool that grew from 20 to 60 instructions because it now handles three more edge cases is a false positive. Mitigation: warn, don't block — the overlay text is advisory, the human still approves; tune thresholds from real forge history once the metric-collection lands (log first, gate later).
3. **No baseline on first forge** — a brand-new tool has nothing to diff against, so this check is a no-op for creation, only for updates. Mitigation: explicitly skip and say so in the overlay ("no baseline — first version") rather than showing a misleading absolute-zero diff.

## Open questions

- Does `sema compile` accept `--stdin` the way `eval` does (`probe.ts` uses `["eval", "--stdin", ...]`), or does the candidate source need a temp `.sema` file too, doubling the temp-file surface?
- What counts as an "exception-handler span" in Sema bytecode — is there a stable opcode/marker for this in the disasm JSON output (`disassemble_to_json`/`chunk_to_json`), or does that need upstream sema changes to expose?
- Should the complexity score be visible to the _model_ (so it can self-correct before submitting) or only to the human at approval time, to avoid the model gaming the metric while still failing behaviorally?
