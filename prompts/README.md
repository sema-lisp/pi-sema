# pi-sema prompt templates

These templates complement the extension's native commands.

- `/sema:*` — native extension operations with custom UI, persistence, approval,
  dashboards, or live registration.
- `/sema-*` — repeatable LLM reasoning workflows.

## Templates

| Template          | Use it when                                                                        | Example                                                                     |
| ----------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `/sema-review`    | You want a report-only code audit, or an explicit fix pass                         | `/sema-review src/parser.sema focus on error paths`                         |
| `/sema-scratch`   | You want to discover how an idea behaves in the live REPL                          | `/sema-scratch parse a duration like "2h 15m"`                              |
| `/sema-debug`     | You have a concrete failure that should be reproduced and fixed                    | `/sema-debug examples/tool.sema fails with unbound variable`                |
| `/sema-implement` | You want Sema code but are unsure whether it should be a script, tool, or workflow | `/sema-implement summarize cargo test failures for the current repo`        |
| `/sema-refactor`  | You want a behavior-preserving structural improvement                              | `/sema-refactor src/report.sema replace nested transforms with a pipeline`  |
| `/sema-explain`   | You need to understand unfamiliar Sema code or runtime behavior                    | `/sema-explain workflows/research.sema how resumption avoids repeated cost` |

## Do not add prompt templates for

- formatting one file;
- running one expression;
- raw docs lookup;
- listing tools or workflows;
- forging a tool;
- authoring/running a workflow.

Those are direct tool or native-command operations and a prompt wrapper adds
latency without adding a meaningful workflow.
