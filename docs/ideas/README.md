# pi-sema idea backlog

Sixteen concrete feature ideas for pi-sema, produced by a 13-agent research
pass: agents fanned out over local research repos (prior art on agent
debugging, tool ecology, memory, and budget management), the web, and a fresh
capability inventory of Sema itself (DAP server, LSP server, disasm, cassette
record/replay, forge pipeline, workflow journal). Each idea below is a full
write-up — problem, mechanism, real pi-sema/Sema modules touched, effort, and
risks — in its own file. Rank number is the file prefix; it's a rough
priority/plumbing order, not a strict must-build-in-this-order queue.

## Ranked index

### DAP/LSP-powered

Ideas that exploit Sema's DAP (`sema-dap`) and LSP (`sema-lsp`) servers —
machinery no existing agent harness wires into a coding-agent loop.

| #   | Idea                                               | Pitch                                                                                                                                                         | Effort |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | [Crash Autopsy](01-crash-autopsy.md)               | When a sandbox run throws, don't hand the agent a stack-trace string — relaunch it under `sema dap` and land the agent AT the crash frame with live locals.   | L      |
| 2   | [Bug Capsules](02-bug-capsules.md)                 | Freeze a failing workflow step — source, LLM cassette, and breakpoint spec — into a sealed artifact the agent can rewind for free, as many times as it needs. | L      |
| 3   | [Silent Compiler Gate](03-silent-compiler-gate.md) | Turn Sema's compiler into an invisible correctness gate on ordinary agent edits — no sandbox execution required.                                              | M      |
| 10  | [Blast Radius](10-blast-radius.md)                 | Before a shared deftool changes, show the agent (and the human approving it) exactly who calls it — not a grep guess, a real symbol graph.                    | M      |

### Forge quality/ecology

Ideas that keep the forge's self-expanding tool library reliable and
uncluttered instead of sprawling.

| #   | Idea                                                           | Pitch                                                                                                                                                                                   | Effort |
| --- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 5   | [Tool ROI Ledger](05-tool-roi-ledger.md)                       | Garbage collection for the forge: journal-mined per-tool economics — demote, merge, quarantine, with statistical honesty.                                                               | M      |
| 6   | [Description Darwinism](06-description-darwinism.md)           | GEPA-style reflective rewriting of MCP tool descriptions, validated against replayed cassette decisions instead of vibes.                                                               | L      |
| 7   | [SOP Constructor](07-sop-constructor.md)                       | Mine completed workflow journals for repeated tool-call sequences — including their error-recovery branches — and offer them as candidate deftools through the existing forge pipeline. | L      |
| 11  | [Pass^k Gate](11-pass-k-gate.md)                               | One green run doesn't make a reliable tool — replay it k times and print the confidence badge on every library entry.                                                                   | M      |
| 12  | [Disasm Regression Profiler](12-disasm-regression-profiler.md) | A forged tool that "still passes tests" but tripled its instruction count is a timeout waiting to happen — catch it at the bytecode level, for free.                                    | M      |

### Workflow evolution

Ideas that rethink how a workflow run itself is represented and recovered
from, using the journal as substrate.

| #   | Idea                                                                          | Pitch                                                                                                                                                                  | Effort |
| --- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 4   | [Workflow Rewind & Branch Explorer](04-workflow-rewind-branch-explorer.md)    | Rewind a journaled workflow run to step N, edit what the agent believed, and fork a new branch — replaying prior LLM calls from cassette at near-zero cost.            | L      |
| 8   | [Break-Loop Restarts](08-break-loop-restarts.md)                              | Workflow step errors suspend instead of fail — the agent or user chooses continue-with-patch, redefine-and-retry, or abort, Lisp Machine style.                        | XL     |
| 14  | [Failure Memory with Tiered Deepening](14-failure-memory-tiered-deepening.md) | Index every journaled failure as episodic memory, and use retrieval hits to surface deeper tool guidance only when the current step actually resembles a past failure. | L      |

### Token/budget economics

Ideas that cut context/token spend directly, using the live Sema process and
the journal's budget events as leverage.

| #   | Idea                                             | Pitch                                                                                                                                   | Effort |
| --- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 9   | [Live Value Bindings](09-live-value-bindings.md) | Stop round-tripping 10k-token tool outputs through the model's context — keep big values in the live Sema image, hand the agent a name. | L      |
| 13  | [Burn-Rate Horizon](13-burn-rate-horizon.md)     | Project the budget curve forward and offer a graceful-degradation menu before a run busts its cap, instead of stalling mid-flight.      | M      |

### UX surfaces

Ideas whose main deliverable is a new pi overlay/interaction surface rather
than a backend mechanism.

| #   | Idea                                                       | Pitch                                                                                                                      | Effort |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------ |
| 15  | [Form Runner](15-form-runner.md)                           | Turn the LSP's "Run" code lens into a pi overlay that runs exactly one top-level form, not the whole file.                 | S      |
| 16  | [Annotated Forge Approval](16-annotated-forge-approval.md) | Replace the forge's yes/no confirm dialog with an annotatable diff surface, so approval becomes steering, not just a gate. | M      |

_Note: #8 and #9 are two independent write-ups of the same "Live Value
Bindings" concept (short version vs. CaveAgent-framed version) — kept both
because they diverge on architecture details (envelope-layer policy vs.
bridge-interception + Sema-side macro shim); reconcile into one spec before
building._

## Suggested build order

Don't build these in rank-number order — build in **plumbing-compounds**
order, where each step lowers the cost of the next:

**15 → 3 → 1 → 2 → 7**

1. **[Form Runner](15-form-runner.md) (#15, effort S)** — the cheapest
   possible slice, and pi-sema's _first_ LSP integration. It proves the
   `sema lsp` sidecar pattern (spawn once, keep alive, round-trip a command)
   that everything DAP/LSP-powered after it reuses.
2. **[Silent Compiler Gate](03-silent-compiler-gate.md) (#3, effort M)** —
   reuses the same sidecar-process pattern Form Runner just proved, now for
   `didOpen`/`didChange` diagnostics on every `.sema` edit. Gives the forge a
   zero-execution pre-flight check for free.
3. **[Crash Autopsy](01-crash-autopsy.md) (#1, effort L)** — moves from LSP
   to DAP, but inherits the "keep a headless `sema` sidecar alive and speak
   its wire protocol" plumbing from steps 1–2. Turns sandbox failures into
   interactive, falsifiable debugging instead of stack-trace guessing.
4. **[Bug Capsules](02-bug-capsules.md) (#2, effort L)** — is Crash Autopsy
   plus the cassette system pi-sema already has for workflow tests; almost
   free once #1's DAP-driving tools (`autopsy`, `debug_eval`, `debug_set`)
   exist. Seals failures into reproducible, token-free replay artifacts.
5. **[Break-Loop Restarts](08-break-loop-restarts.md) (#8, effort XL)** — the
   most ambitious idea in the set, and only tractable once break-on-uncaught
   DAP driving (#1) and journaled deterministic replay (#2) both already
   work. It turns them into a live intervention: workflow errors _suspend_
   instead of fail, and the agent or user resumes with a patched value, a
   redefined function, or an abort — Lisp Machine restarts for an agent
   harness.

Everything else in the backlog is valuable but not on this critical path —
build it opportunistically once the DAP/LSP plumbing above exists, since most
of it (Blast Radius, Pass^k Gate, Disasm Regression Profiler) leans on the
same sidecar/process patterns this chain establishes.
