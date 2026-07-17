# Manual TUI test checklist

The widget/overlay surface is TUI-only and not automatable — walk this after
UI-touching changes. Setup: `npm run build`, then `pi install /path/to/pi-sema`
(or `/reload` in an existing session) in a scratch project with the `sema`
binary on PATH.

## Bridge

- [ ] Session start shows the sema version in the status bar (no warning).
- [ ] `/sema:tools` lists the bridged `sema_*` tools; notebook tools are absent
      (default `excludeTools: ["notebook/*"]`).
- [ ] Ask the agent to "evaluate (+ 1 2) with sema" → `sema_eval` tool call
      succeeds inline.
- [ ] Kill the `sema mcp` process manually → one auto-restart; kill again →
      "bridge offline" error notification, tools return a bridge-down error.

## Forge

- [ ] `/sema:forge a tool that counts the lines in a file` → agent authors,
      probe passes, confirm dialog shows the full source.
- [ ] Approve → file lands in `.pi/pi-sema/tools/`, success mentions the
      `sema_*` name; next turn the agent can call it.
- [ ] `/reload` → forged tool still loads (filepath mode) and is callable.
- [ ] Ask for a tool with deliberately broken code pasted verbatim → probe
      fails with line/col diagnostics, agent repairs within 3 rounds.
- [ ] Decline the confirm → nothing stored, agent does not resubmit unchanged.

## Workflows

- [ ] `/sema:workflow …` (any small no-LLM flow) → check passes, preview shows
      phases/budget/steps, two confirms (store, run).
- [ ] Run shows the live widget above the editor: phase glyphs advance,
      agents/budget update, widget clears on completion.
- [ ] Esc during a run aborts it; `sema_workflow_run` result offers
      `resume="<id>"`; resuming replays memoized leaves instantly.
- [ ] `/sema:workflows` opens the overlay: newest-first list, live runs marked,
      enter drills into the phase/agent tree, esc backs out, q closes.
- [ ] Overlay reopened after close re-reads from disk (no stale state).

## Config

- [ ] `pi --sema-exclude 'docs*'` hides the docs tools for that launch.
- [ ] With a patched sema (`sema mcp --help` shows `--sandbox`) and
      `"sandbox": {"mcp": "strict"}` in config.json, a forged tool calling
      `(shell …)` returns a permission error; with stock sema the session
      warns that sandboxing is unavailable.
