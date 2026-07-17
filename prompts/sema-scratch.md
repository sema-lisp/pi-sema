---
description: Iterative Sema scratchpad — explore an idea with rapid sema_eval round-trips
argument-hint: "[what to explore]"
---

Open an iterative Sema scratch session about: $ARGUMENTS

Work in small sema_eval round-trips: evaluate one expression at a time, show me
the result, and build up state incrementally (definitions persist in the live
environment between calls). Verify any builtin you're unsure of with
sema_docs_search first. When we land on something worth keeping, offer to
forge it into a persistent tool (create_sema_tool) or save it as a script —
don't do either without asking.
