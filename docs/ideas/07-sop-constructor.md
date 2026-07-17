# SOP Constructor
> Mine completed workflow journals for repeated tool-call sequences — including their error-recovery branches — and offer them as candidate deftools through the existing forge pipeline.

## Why (the non-obvious insight)

The forge (`src/forge/forge.ts`) is entirely reactive: a tool only gets created when the agent, mid-task, decides to call `create_sema_tool`. That means any pattern the agent re-derives turn after turn — "query X, if nil retry with fallback Y, else parse Z" — never gets promoted unless the agent happens to notice the repetition itself. Journals already contain everything needed to notice it externally: `workflows/journal.ts`'s `JournalTailer`/`readJournalEvents` expose the full `tool_call`/`tool_result` sequence including failures, and workflow runs are resumable and cassette-replayable, so a mined candidate's test form can be verified deterministically without spending new tokens. The non-obvious part, per the Voyager/SkillsBench precedent: a mined skill that only encodes the happy path is *worse than no skill* — silent failure on the untested branch is more dangerous than the agent improvising. So the miner must extract the `cond`/`try` recovery branches actually observed, not just the modal path.

## How it works (user-visible behavior, step by step)

1. A periodic job (session-start hook or external cron, analogous to a `jake`-style recipe) scans recent run directories under the configured `runDir` (`defaultRunRoot`, `workflows/runner.ts:40`) for completed journals.
2. An n-gram/subsequence miner clusters repeated `tool_call` sequences that include at least one observed failure-then-recovery pair (e.g. a nil result followed by a fallback call).
3. A model synthesizes a candidate `(deftool ...)` whose body mirrors the observed branches, plus a test form driven by the mined inputs.
4. The candidate is submitted through the *existing* forge pipeline unmodified: `verifyToolSource` (`forge/probe.ts`) strict-sandbox probe, then the human `ctx.ui.confirm` gate in `forge/forge.ts`, tagged in its description with provenance — `"mined from runs #12, #17, #23"`.
5. On approval it's stored via `store.save` and injected live exactly as an agent-authored tool would be — no new persistence or execution path.

## Architecture (which pi-sema modules touched/added; which pi extension APIs; which sema features/CLI/LSP/DAP requests; data flow)

- **New**: `src/forge/sop-miner.ts` — the offline miner. Reads journals via `workflows/journal.ts` helpers (`readJournalEvents` for finished runs), extracts `tool_call`/`tool_result`/error event sequences keyed by `run_id`.
- **New**: a small clustering/frequency pass (subsequence mining over the event stream) plus a synthesis step that calls the pi extension's model API to draft a `(deftool ...)` — reusing `CREATE_TOOL_DESCRIPTION`/`CREATE_TOOL_GUIDELINES` from `forge/prompts.ts` as the system framing so mined and agent-authored tools follow the same source conventions.
- **Reused unchanged**: `forge/probe.ts`'s `verifyToolSource` (strict `--sandbox strict --no-llm` sema eval probe) and `forge/forge.ts`'s approval + injection flow (`ctx.ui.confirm`, `store.save`, `bridge.injectSource`, `bridge.refresh`) — the whole point is zero new verification or persistence surface, only a new *source* of candidates feeding the same gate.
- **Trigger**: either a pi extension session-start hook (`src/index.ts` is where hooks are wired today; check its current hook registrations) or an out-of-band cron-style invocation (`CronCreate`/periodic job) that runs the miner headlessly and queues candidates for the next interactive approval pass rather than blocking a session.
- **Data flow**: run journals (`.sema/runs/<runId>/events*.jsonl`) → miner → synthesized deftool source + test → `verifyToolSource` (sandboxed, cassette-deterministic since the mined test replays recorded LLM calls) → `ctx.ui.confirm` approval UI tagged with source run IDs → `store.save` + live inject, same as manual forging.

## Grounding & prior art

SOP-Constructor insight (arXiv 2607.07321); Agent Workflow Memory offline-vs-online induction insight; Voyager/SkillsBench execution-verification requirement; Live-SWE-agent self-evolution.

## Effort & risks

Effort: **L**

1. **Mined tools encode a spurious pattern from too few examples** (e.g. 2 coincidentally similar sequences). Mitigation: require a minimum cluster size (n≥3-5) before synthesis, and surface the count in the approval prompt so the human gate has the evidence.
2. **Synthesized recovery branches don't actually match sema's error semantics** (the miner infers a `cond` shape from journal-level tool results, which may not map cleanly onto sema's condition/exception model). Mitigation: the existing strict-sandbox probe already catches non-executing candidates; additionally, generate the test form to explicitly exercise the recovery branch (feed it the failing input from the mined run) so probe failure surfaces branch-level bugs, not just load-time errors.
3. **Miner runs cost real compute/tokens on every session start**, competing with the interactive session. Mitigation: run as an out-of-band periodic job rather than a session-start hook, queuing candidates for review rather than synthesizing inline.

## Open questions

- Does pi-sema currently have any session-start or periodic-job hook wired in `src/index.ts`, or does this require a new extension lifecycle point?
- How is "the same pattern" defined precisely across runs with different literal arguments — structural tool-name sequence match, or something embedding-based?
- Should mined candidates require a stricter human review step than agent-authored ones, given there's no single agent turn "vouching" for the design?
