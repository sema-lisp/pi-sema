---
description: Explore a Sema idea in a live REPL and finish with a verified keeper
argument-hint: "<question, expression, or idea>"
---

Scratch goal: $ARGUMENTS

Use the live Sema environment as a small experimental lab.

## Method

1. Convert the goal into one observable success condition. Do not ask a
   clarifying question unless materially different interpretations would change
   the experiment.
2. Begin with the smallest expression that can teach us something useful.
3. Work in short `sema_eval` cycles. Definitions may persist between calls, so
   build on working state rather than repeatedly starting over.
4. Look up a builtin before using it when its name, semantics, or argument order
   is uncertain. Do not perform documentation calls for obvious arithmetic or
   syntax.
5. After each cycle, track:
   - what was evaluated;
   - what happened;
   - what that result rules in or out;
   - the next experiment.
     Report meaningful milestones rather than narrating every trivial evaluation.
6. Keep side effects disabled by default. Do not write files, spawn processes,
   access the network, make paid LLM calls, or persist definitions unless those
   effects are intrinsic to the stated experiment and are disclosed first.
7. Stop when:
   - the success condition is met;
   - a concrete runtime or capability blocker is established; or
   - three materially different attempts fail to produce new evidence.

## Final result

Return:

- **Conclusion** — what the experiment established.
- **Keeper** — the smallest complete working Sema snippet, when one exists.
- **Evidence** — the decisive evaluations and results.
- **Caveats** — assumptions or untested paths.
- **Best destination** — `discard`, `snippet`, `script`, `deftool`, or
  `defworkflow`, with one sentence explaining why.

Do not save, forge, submit, or register anything without explicit authorization.
