---
description: Explain Sema code from syntax through runtime behavior using verified APIs
argument-hint: "<file, form, or symbol> [specific question]"
---

Explanation target: $ARGUMENTS

Explain the requested Sema code accurately enough that the reader could modify
or debug it afterwards.

## Procedure

1. Locate the relevant definition and enough surrounding code to understand how
   it is loaded and called.
2. Start with the purpose and observable input/output behavior.
3. Walk through the evaluation and data flow in logical chunks rather than
   translating every parenthesis mechanically.
4. Verify unfamiliar builtins with the live docs and preserve their true argument
   order and semantics.
5. Use a harmless `sema_eval` probe when runtime behavior is easier to
   demonstrate than describe.
6. Explicitly cover, when applicable:
   - lexical and call-time name resolution;
   - maps, vectors, keywords, threading, and short lambdas;
   - side effects and capability boundaries;
   - error and empty-input paths;
   - deftool schemas and registration;
   - workflow phases, checkpoints, steps, parallelism, budgets, and resumption.
7. Do not modify the source.

## Output

- **What it does**
- **How execution flows**
- **Important forms and builtins**
- **Inputs, outputs, and side effects**
- **Gotchas**
- **Small runnable example or probe**, when useful
- **Answer to the specific question**, if one was supplied

Distinguish verified runtime facts from reasonable inferences.
