# Tool ROI Ledger

> Garbage collection for the forge: mine run journals into per-tool economics and let the dashboard propose demotions, merges, and quarantines.

## Why (the non-obvious insight)

The forge's success is its failure mode. Every research thread on self-extending agents converges on the same finding: continuous tool creation produces sprawl, and sprawl _measurably degrades tool selection_ (RAG-MCP scaling data shows selection accuracy collapsing as tool count grows). Nobody ships the counterpart: a principled way to _shrink_ the tool population. The journals pi-sema already writes contain everything needed — which tools get called, whether the runs they appear in succeed, and what they cost — so tool ecology is a query problem, not a new data-collection problem.

## How it works (user-visible behavior)

1. A background pass (session start, or `/sema:tools gc`) folds all run journals into a per-tool ledger: call frequency, success-rate-when-called, tokens-per-successful-run, co-occurrence with failed runs, days-since-last-use.
2. The dashboard gains a **Tool GC** pane: each library tool shows a trust score and a proposed action — _keep_, _demote to cold tier_ (excluded from registration, still on disk), _merge candidate_ (near-duplicate of another tool), or _quarantine_ (correlated with failures).
3. Near-duplicate detection uses Sema's own embeddings over tool descriptions plus an LSP `workspace/symbol` scan, so merge proposals come from real definitions, not name similarity.
4. Every proposal is a one-key approval that rewrites the library tier files; nothing is deleted without the human gate.
5. Statistical honesty is enforced: no verdict below ~10 observations, and scores render with confidence intervals ("3/4 succeeded — low confidence").

## Architecture

- **New `src/library/ledger.ts`** — journal fold: consumes `JournalEvent`s via the existing `readJournalEvents` (`src/workflows/journal.ts`) across all run dirs, keyed by tool name; persists `ledger.json` next to the tiers in `LibraryStore` (`src/library/store.ts`).
- **`src/ui/dashboard.ts`** — add the GC pane as a third view (list ⇄ detail ⇄ tool-gc), reusing the overlay component's key-handling; approval actions call `LibraryStore` moves (new `cold/` kind directory) and `SemaBridge.refresh()` to drop deactivated tools via `setActiveTools`.
- **Embedding dedup** — shell out through the bridge's `eval` (`(llm/embed …)` + `(vector-store/…)`) so no new JS-side embedding dependency exists; LSP `workspace/symbol` scan via a short-lived `sema lsp` sidecar for definition-level overlap.
- **Feeds forward**: the ledger becomes the data source for Description Darwinism (06) validation and Pass^k (11) variance history.

## Grounding & prior art

Subtraction Principle and SER (Δpass-rate per 1k description tokens) insights; tool trust scores; statistical-power blindness (n≥10–15 gating); RAG-MCP tool-sprawl scaling; LSP workspace-scan dedup — from the research-adaptive-skill-arbitration and research-skill-marketplaces mining passes.

## Effort & risks

**M.**

1. _Sparse data early on_ — most tools will sit below the n≥10 threshold for weeks. Mitigation: the pane says "insufficient data" honestly; frequency/recency still render.
2. _Wrong demotions annoy_ — a seasonal tool (used monthly) looks dead weekly. Mitigation: demotion is reversible (cold tier, one-key restore), never deletion.
3. _Journal drift_ — the ledger depends on tool_call attribution in workflow journals; direct pi-tool calls outside workflows aren't journaled by sema. Mitigation: also count bridge-side invocations in a lightweight pi-side tally (session entries via `pi.appendEntry`).

## Open questions

- Should cold-tier tools still be findable by a lazy `sema_tool` proxy (docs/research proposal #7) so demotion never loses capability, only context weight?
- Does the ledger belong per-project, global, or both (a tool can be hot in one repo and dead in another)?
