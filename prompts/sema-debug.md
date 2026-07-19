---
description: Reproduce, diagnose, and fix a concrete Sema failure with regression evidence
argument-hint: "<file, expression, error, or symptom> [--diagnose-only]"
---

Debug target: $ARGUMENTS

Find the actual failure mechanism and prove the correction. Unless the arguments
include `--diagnose-only`, make the smallest appropriate source fix.

## Procedure

1. Resolve the relevant file, expression, symbol, workflow run, and error text
   from the request and project context.
2. Reproduce the failure before editing. Prefer `sema_eval` for a minimal call,
   `sema_run_file` for file behavior, and the existing run ID for workflow
   failures.
3. Reduce the problem to the smallest expression or call that still fails.
4. Read the implicated source and its callers. Record the expected behavior and
   the observed behavior.
5. Inspect the structured error fields, including hint and source location.
6. Verify the exact names and signatures of builtins involved in the failure.
   Do not broaden the docs search to unrelated code.
7. State one leading diagnosis and the evidence supporting it. If evidence is
   insufficient, run the next discriminating experiment rather than guessing.
8. Apply the smallest fix that addresses the cause, not merely the symptom.
   Do not swallow errors, weaken validation, remove useful checks, or hard-code
   the reproduction case.
9. Format the changed code and rerun:
   - the original reproduction;
   - the containing file or workflow check;
   - one nearby edge or failure case when practical.
10. For a failed workflow, resume the same run ID after the correction when
    memoized completed work should be retained.

## Output

### Root cause

Explain the failure mechanism and where it occurs.

### Change

List the exact files or definitions changed and why.

### Proof

Show the before/after reproduction and all relevant verification results.

### Residual risk

State any untested path, environment dependency, or docs/runtime mismatch.

With `--diagnose-only`, provide the proposed minimal patch but do not modify files.
Do not forge or persist a new tool as a debugging shortcut.
