# Description Darwinism
> GEPA-style reflective rewriting of MCP tool descriptions, validated against replayed cassette decisions instead of vibes.

## Why (the non-obvious insight)

Every `sema_*` tool the agent sees is generated once, at `registerOne` time in `SemaBridge`, from whatever description the deftool author wrote — `tool.description ?? \`Sema MCP tool ${tool.name}\``. That string is the *retrieval index* the model uses to pick a tool, yet nothing in pi-sema ever revisits it after forging. Meanwhile the bridge already re-registers a tool under the same pi name whenever its signature (description + schema) changes (`bridge.ts:131-139` — "Re-forged tool... re-register under the SAME pi name"). That mechanism exists for forge edits; there's no reason it can't be driven by a reflective process instead of a human. The other non-obvious piece: tool-selection interference is model-version-dependent, so a description that reads well to one model can actively mislead the next — descriptions need versioned variants, not a single frozen string.

## How it works (user-visible behavior, step by step)

1. After a session (or on a periodic job), a miner scans recent journals for tool-selection failures: the agent called the wrong `sema_*` tool then self-corrected, or invoked one with a schema-violating payload.
2. For each failure, a cheap reflection model proposes an edited description for the offending tool.
3. The candidate description is validated by replaying the *exact* historical decision context (the preceding turns) through a cassette-backed LLM call with the new description substituted for the old one in the tool list — if the replay now picks the right tool, the variant is a win.
4. Winning variants are hot-swapped live via `bridge.injectSource` + `bridge.refresh()` — no restart — and persisted to `library/store.ts` as a `(tool_name, model_version)`-keyed variant set.
5. A dashboard pane shows the Pareto set: which description variant is active for which model family, with before/after selection-accuracy deltas so nothing regresses silently.

## Architecture (which pi-sema modules touched/added; which pi extension APIs; which sema features/CLI/LSP/DAP requests; data flow)

- **New**: `src/forge/darwin.ts` — the miner + reflection + replay loop. Reads journal events via `workflows/journal.ts`'s `readJournalEvents`/`JournalTailer` pattern, filtering `tool_call`/`tool_result` sequences for mis-selection signatures.
- **`src/bridge/bridge.ts`** — reuse, don't fork, the existing re-registration path: `registerOne(tool, existingPiName)` already re-registers a tool under its current pi name when `signatures.get(tool.name) !== signature` (`bridge.ts:132-139`). Description Darwinism just needs a way to push a *new description string* through that same path without a real MCP `tools/list` change — likely a thin wrapper that calls `pi.registerTool` directly with the winning description, bypassing a full server round-trip for a pure UI-side variant swap, while keeping the underlying sema `deftool` source untouched.
- **`src/library/store.ts`** — extend `LibraryEntry`/persistence to carry a small sidecar (e.g. `<name>.descriptions.json`) mapping `model_version → description variant`, loaded at bridge-start time so the active variant is chosen per configured model before registration.
- **Validation harness**: reuses `sema eval --stdin --json` (the same primitive `forge/probe.ts` uses) is NOT needed here since no sema code changes — validation is pure LLM replay, driven through pi's own cassette-aware chat completion path (the same one workflows use for `(llm ...)` steps), so no new sema surface is required, only pi-side plumbing.
- **Data flow**: journal → miner (candidate description) → cassette replay (accept/reject) → `bridge.ts` live re-registration → `library/store.ts` versioned persistence → dashboard Pareto view.

## Grounding & prior art

GEPA + MCP Adapter insight; tool-description-as-learnable-retrieval-index insight; model-version dependency of tool interference insight; cassette replay for cheap counterfactual evaluation.

## Effort & risks

Effort: **L**

1. **Reflection loop optimizing for the wrong metric** (replay-accuracy on a small failure set overfits and degrades real selection). Mitigation: gate promotion on a held-out replay sample and require a minimum failure-case count before accepting a variant, mirroring the n≥10 statistical-power gating used elsewhere in the idea set (Tool ROI Ledger).
2. **Live description swap races a real forge update** — if the agent forges a new version of the same tool while a Darwinism variant is pending, `signatures` bookkeeping in `bridge.ts` could clobber or be clobbered. Mitigation: Darwinism variants apply as a description overlay on top of the forge-authored base, invalidated whenever the base signature changes.
3. **Variant sprawl** — versioned-by-model-family descriptions multiply storage and audit surface. Mitigation: cap retained variants per tool (keep only the current winner + previous), same discipline as the Pass^k quarantine tier.

## Open questions

- Where does "cassette replay of a decision point" actually hook into pi's chat loop — does pi expose a low-level "replay this exact context with tool list X" primitive, or does this require a bespoke harness that reconstructs the turn?
- Should description variants be scoped per-project (`.pi/pi-sema`) or globally, given tool selection failures may be workload-specific rather than model-specific?
- How is "wrong tool then correction" reliably detected from journal events alone, versus a legitimate multi-tool sequence?
