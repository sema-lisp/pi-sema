---
description: Review Sema code with runtime evidence; report-only unless --fix is explicit
argument-hint: "<file-or-directory> [focus] [--fix]"
---

Review target: $ARGUMENTS

Perform an evidence-based Sema review. Treat this as report-only unless the
arguments explicitly include `--fix`.

## Scope

- Resolve the requested file, directory, symbol, or review focus.
- For a directory, inspect relevant `.sema` sources and ignore generated,
  vendored, cache, and run-journal files unless they are directly implicated.
- Read enough surrounding context—loads, callers, configuration, schemas, and
  workflow arguments—to judge behavior rather than reviewing isolated syntax.
- Preserve the project's established conventions unless they are incorrect.

## Review procedure

1. Identify the public behavior, side effects, and failure boundaries of the
   reviewed code.
2. Verify with `sema_docs_search` / `sema_docs` every builtin that:
   - appears in a suspected finding;
   - has a non-obvious signature or argument order;
   - is newly introduced or changed; or
   - controls filesystem, process, network, database, LLM, or workflow behavior.
     Do not spend calls re-verifying obvious, unrelated builtins unless the user
     asks for an exhaustive API audit.
3. Check formatting without mutating the source. Use a non-writing formatter
   check when available; otherwise compare formatter output in memory.
4. If the code contains a `defworkflow`, run the strict workflow checker and
   interpret the parsed diagnostics. Treat errors as blocking and warnings as
   advisory unless a warning reveals a real behavioral problem.
5. Run the smallest safe probes needed to validate findings:
   - exercise changed or suspicious functions;
   - load tool definitions in an isolated process when possible;
   - avoid destructive writes, external network calls, shell execution, paid
     LLM calls, or persistent registration unless already authorized.
6. Separate confirmed defects from risks, style suggestions, and unknowns.
7. With `--fix`, apply only confirmed, minimal fixes; format the changed files;
   then rerun every check that supported the finding.

## Output

Return these sections:

### Verdict

A short assessment of whether the code is correct, risky, or blocked.

### Findings

Order by severity: `blocking`, `high`, `medium`, `low`.
For each finding include:

- file and line or form;
- the observed evidence;
- why it matters;
- the smallest concrete correction;
- whether it was runtime-confirmed, docs-confirmed, or inferred.

Do not invent findings merely to fill severity levels.

### Verification

List the native tools or CLI commands used and their observed results.

### Good decisions

Call out concise examples of code that is notably correct or idiomatic.

### Remaining uncertainty

State anything that could not be executed or verified.

When `--fix` was supplied, also include the changed files and the post-fix
verification result.
