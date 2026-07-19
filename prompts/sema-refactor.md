---
description: Refactor Sema code while proving that observable behavior is preserved
argument-hint: "<file-or-symbol> <refactoring goal>"
---

Refactoring request: $ARGUMENTS

Improve the requested Sema code without changing its externally observable
behavior unless the request explicitly asks for a behavior change.

## Procedure

1. Resolve the target definition and read its callers, loaded dependencies,
   schemas, workflow checkpoints, and relevant project conventions.
2. Write down the behavior that must remain invariant:
   - accepted inputs;
   - returned values or result shape;
   - errors and validation behavior;
   - side effects and ordering;
   - tool schema or workflow checkpoint compatibility.
3. Establish a baseline by running representative calls before editing.
4. Identify the specific structural problem being improved. Do not mix unrelated
   cleanup into the change.
5. Verify any affected builtin names and signatures.
6. Apply the smallest coherent refactor.
7. Format the source and rerun the baseline plus one meaningful edge case.
8. If exact preservation is impossible, stop and state the compatibility break
   instead of silently changing behavior.

## Output

### Refactoring

Describe the structural improvement and the files or forms changed.

### Preserved contract

List the observable behaviors demonstrated to remain unchanged.

### Evidence

Show the baseline and post-change results.

### Tradeoffs

Mention any readability, performance, compatibility, or maintenance consequence.

Do not forge a replacement tool, change persistence tier, rename public symbols,
or alter workflow checkpoint keys unless the request explicitly authorizes it.
