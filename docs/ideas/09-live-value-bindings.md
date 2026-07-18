# Live Value Bindings: CaveAgent-style state injection over the bridge

> Stop round-tripping 10k-token tool outputs through the model's context — keep big values in the live Sema image, hand the agent a name.

## Why (the non-obvious insight)

pi-sema already has the one precondition this needs for free: `sema mcp` is a **single long-lived process per session** (`src/bridge/process.ts`), and the `eval` tool runs against a _shared, persistent environment_ — `deftool` definitions injected by the forge are visible on the very next call. That's already "runtime as locus of state." What pi-sema does _not_ do yet is exploit it for data, only for code. Every tool result, however large, is flattened to a text block and shipped into the model's context (`SemaBridge.registerOne`, `bridge.ts:271-279`, joins `result.content` into one string with no size check). A `docs_search` hit list, a disasm dump, or a notebook dataframe pays full token price every time it's touched, and diluted attention on a 10k-token blob is a known failure mode (the Arize postmortem). CaveAgent's insight — don't move the value, move a reference to it — maps almost exactly onto what the bridge already has: a durable eval environment that outlives any single tool call.

## How it works (user-visible behavior, step by step)

1. Agent calls `sema_docs_search` (or any bridge tool). The result is 8,000 tokens of hits.
2. Instead of returning the text, pi-sema evaluates `(def $r17 <value>)` in the live server env and returns: `{binding: "$r17", type: "list", shape: "23 items", preview: "[{title: \"pattern-match\", ...}, ...]"}` — a few hundred tokens, structure-preserving (the Arize fix: never truncate mid-structure).
3. Agent's next move is a short Sema expression via a new `sema_eval_on` tool: `(nth $r17 3)`, `(filter (fn (h) (str/contains? (:title h) "macro")) $r17)`. Only the _filtered_ result comes back — often small enough to inline directly.
4. The TUI status/footer (extending `ui/dashboard.ts` conventions) shows a live-bindings table (`$r17: list, 23 items, docs_search @ 14:02`) so the user can see what the agent is holding without it costing a token.
5. Bindings are swept on `session_shutdown` (the bridge process dies with the session) or on an explicit `sema_forget $r17`.

## Architecture (real modules)

- **`src/envelope.ts`** — add a `ResultPolicy` step: after `parseEnvelope`, check byte length / structural size of `value`; over threshold, don't inline it.
- **`src/bridge/bridge.ts`** (`registerOne`, lines ~231-281) — the `execute()` closure is where results currently get flattened to `content: [{type:"text", ...}]`. This is the interception point: wrap the MCP `eval`/tool call so oversized results get bound server-side instead of returned raw. Needs a companion Sema-side helper (a small stdlib addition or a wrapper `deftool` injected at bridge start via `bridge.injectSource`) that does the `(def $rN ...)` binding and returns the preview envelope — cleanest done as a `(defmacro with-binding ...)` shim eval'd once per session start in `SemaBridge.start()`.
- **New `sema_eval_on(binding, expr)` tool** — thin wrapper around the existing `eval` MCP tool (`bridge.ts` already special-cases `tool.name === "eval"` for the deftool re-sync fast path at line 263; this needs the same treatment for binding-scoped evals).
- **`src/ui/dashboard.ts`** — add a live-bindings panel alongside the existing run-list/detail views (`DashboardComponent`), sourced from a bridge-exposed `listBindings()` call (round-trip a tiny introspection eval, similar to `sema_status`).
- **Budget proof** — pi's own token accounting (already tracked per session by the host) shows the before/after; pairs naturally with idea 4 (Tool ROI Ledger).

## Grounding & prior art

CaveAgent runtime-as-locus-of-state insight (59% token cut); Arize attention-dilution postmortem (hard output budgets, structure-preserving previews); conversational result compression insight; marimo-pair scratchpad insight.

## Effort & risks

**Effort: L**

1. **Binding leakage across turns/aborts** — a call aborted mid-eval (`raceAbort` in `bridge.ts`) could leave a `def` half-written. Mitigation: bind-then-verify in one atomic eval string, never two round-trips.
2. **Threshold tuning** — too aggressive and small-but-structured results (a 200-token JSON the model actually needs verbatim) get needlessly indirected, adding a round-trip. Mitigation: size AND type heuristics (dataframes/embeddings always bind; scalars/short lists never do), configurable via `PiSemaConfig`.
3. **Sandbox interaction** — bound values living in the "unsandboxed by default" MCP env (per `create_sema_tool`'s approval text) means `sema_eval_on` expressions run with the same trust level as any other eval; no new attack surface, but worth stating explicitly in the tool description so the model doesn't treat bindings as a sandbox escape hatch.

## Open questions

- Does Sema's `eval` support cheap introspection (`(type $r17)`, `(count $r17)`) without materializing the whole value, for the preview step?
- Should bindings be named by the agent (semantic names) or always `$rN` (simpler collision-freedom)?
- Cross-session persistence: bindings die with the `sema mcp` process today — worth it, or should high-value bindings (e.g. a large fine-tuned index) survive a restart via a snapshot file?
