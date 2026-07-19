# Workflow UI Rendering Design

Pi-sema will render workflow state through three purpose-built components instead of sharing newline-joined text between every surface:

```text
JournalTailer -> RunState
                 |- workflow tool renderer (compact or expanded)
                 |- live widget (at most five rows)
                 `- dashboard overlay (scrollable list and detail views)
```

## Rendering contract

Every custom component returns one array item per terminal row. Journal-derived values are converted to single-line display text before theme styling, and every final row is truncated with Pi TUI's ANSI-aware `truncateToWidth`. This prevents embedded newlines, control sequences, and wide Unicode from escaping the component's bounds.

Tool updates carry a serializable workflow snapshot in `details`. `renderCall` and `renderResult` own terminal presentation; model-facing tool text remains concise. Partial results show the current phase and active agents, while expanded results show all phases and the failure or authentication detail.

The widget is installed once per tool call as a mutable component. Updates replace its snapshot and request a render. It shows the run summary, current phase, and the most relevant active agents within five rows. Cleanup runs in `finally`, including failures and cancellation.

## Dashboard behavior

The overlay uses themed chrome and maintains an explicit viewport. Arrow keys or `j`/`k` move list selection and keep it visible. Detail view scrolls with arrow keys, `j`/`k`, Page Up, and Page Down. The footer remains visible and reports the current window.

Historical folds are cached by a signature of every journal segment's name, size, and modification time. Resume segments participate in both cache invalidation and newest-first ordering. A selected live run is tailed incrementally; when `run.ended` arrives, the detail view stops labeling it live and loads its result without reopening the overlay.

## Resource discovery

Skill validation only visits directories. Prompt validation excludes documentation pages such as `README.md`, so packaged prose is not mistaken for an executable prompt template.

## Verification

Regression tests cover terminal-safe rows, finished summaries, bounded widgets, structured tool details, scrolling, live-to-terminal transitions, resume-segment cache invalidation, and resource discovery. The final gate runs focused tests, the complete test suite, TypeScript checks, a production build, and `git diff --check`.
