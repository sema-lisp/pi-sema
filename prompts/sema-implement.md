---
description: Implement a Sema capability using the smallest correct artifact type
argument-hint: "<desired behavior and constraints> [--script|--tool|--workflow]"
---

Implementation request: $ARGUMENTS

Build the requested capability in Sema and choose the smallest execution surface
that satisfies the real requirement.

## Artifact decision

Honor an explicit `--script`, `--tool`, or `--workflow` override. Otherwise use:

- `sema_eval` or an inline form for a one-time answer or proof.
- A `.sema` script for repeatable execution that does not need live tool
  registration, resumability, or journaled LLM steps.
- A `deftool` for bounded reusable behavior that should be callable from Pi.
- A `defworkflow` for checkpointed, resumable, budgeted, parallel, pipelined, or
  multi-agent/LLM work.
- A `defagent` only when reusable specialized judgment is genuinely required;
  do not use one as decoration.

Before creating something new, inspect the project and active Sema library for
an existing definition that already provides the capability.

## Procedure

1. Restate the observable input/output contract and important side effects.
2. Choose the artifact type and explain the decision in one sentence.
3. Identify required capabilities: filesystem, process, network, database,
   environment, LLM, workflow, or Pi-tool access.
4. Verify all non-obvious builtins and signatures before relying on them.
5. Implement the smallest complete version that follows local conventions.
6. Format and exercise the public entrypoint with:
   - one normal case;
   - one meaningful boundary or failure case when practical.
7. For a `deftool`, use the approved `create_sema_tool` lifecycle and invoke the
   registered tool in the same turn.
8. For a `defworkflow`, use `submit_sema_workflow`, then run or resume it and
   inspect the resulting status.
9. Do not claim success if the selected artifact could not be executed.

## Output

- **Artifact choice**
- **Files or persistent definitions created/changed**
- **How to invoke it**, with a concrete example
- **Verification evidence**
- **Capabilities and side effects**
- **Known limits or next extension point**

Avoid speculative abstractions, unused configuration, and placeholder branches.
