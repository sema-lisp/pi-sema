---
description: Review a .sema file — format, static checks, verified builtin usage, and a dry probe
argument-hint: "<file.sema>"
---

Review the Sema source file `$1` thoroughly:

1. Read it. For EVERY slash-namespaced builtin it calls, verify the name and
   argument order with sema_docs_search / sema_docs — do not trust memory
   (arg-order bugs run silently; e.g. regex/replace-all is pattern,
   replacement, text).
2. Run `sema fmt --check` on it and report drift.
3. If it contains a defworkflow, run `sema workflow check $1 --strict --json`
   and explain every diagnostic (gate on errors; warnings are advisory).
4. If it defines tools, probe-load it with sema_eval in a sandboxed dry run
   where feasible and confirm each deftool registers.
5. Report: correctness issues (with line refs), naming/style deviations from
   Sema conventions (slash namespaces, ? predicates, threading macros), and
   concrete fixes. Apply fixes only if I ask.
