# Changelog

## Unreleased

## 0.2.1 — 2026-10-22

### Added

- **Packaged skills + prompt templates** (`pi.skills` / `pi.prompts`): the `sema` skill
  (deep authoring reference with verified gotchas, progressive disclosure) and the
  `/sema-review`, `/sema-scratch` templates.

### Changed

- Workflow runs now preserve `needs-approval` and `rejected` as distinct terminal
  states, resolve relative run directories from the session working directory, and
  give correct recovery instructions.
- Configuration files are validated before merge. Invalid values are ignored with a
  warning instead of breaking extension startup.
- Removed the unsupported `--sema-budget`, `sandbox.workflows`, and
  `workflows.defaultBudgetUsd` controls. Sema 1.36 cannot enforce these at the
  workflow-run level; budgets remain part of each workflow's `:budget` metadata.
- **Single theme**: dropped `sema-light` (Pi themes cannot set the terminal background,
  so a light variant only works in light terminal profiles — cut until there's demand).
  The `sema` theme now matches the editor-reference aesthetic: burnt-umber `#27160c`
  selection/user-message band on `#131110`, sampled from the canonical screenshot.
- **Themes**: two bundled Pi themes, `sema` (dark) and `sema-light` (parchment), translated
  from Sema's website brand palette and syntax highlighting. Shipped via `pi.themes` in
  `package.json`; switch via `/settings` → Theme, or `pi --theme sema`. Validated against
  Pi's own theme schema in `test/theme.test.ts`.
- Themes refined against the canonical BrandGuide + design-system tokens: functions/builtins
  steel `#88a8b8`, variables mauve `#b898c8` (per `ui/src/styles/tokens.css`), semantic
  success/error `#6a9955`/`#c85555`, border `#2b2620`, gold-soft selection overlay, gold-bright
  links, brand-blend tool backgrounds, and the `thinkingMax` tier (optional in Pi's schema,
  contrary to the earlier exactly-required test assumption).

### Fixed

- Pi-provided runtime packages are now peer dependencies, preventing duplicate module instances and Pi startup warnings.
- Pi now receives failed extension tool results with `isError: true`.
- MCP crash recovery stops after one automatic restart, newly discovered tools do not
  reactivate tools disabled by the user, and an already-aborted call does not start a
  Sema subprocess.
- Tool and workflow creation require interactive approval before persistence.
- Stored descriptions remain comments on every line, so description text cannot become
  unchecked Sema source.
- Forge uses the valid `tool/invoke` form, reports excluded tools accurately, and accepts
  valid definitions that contain form examples inside strings, comments, or quoted data.
- Workflow submission enforces the declared name, removes validation scratch directories,
  and validates the exact source that it stores.
- The injected Sema reference uses supported comment and `deftool` syntax, and projects are
  rescanned after an initial negative `.sema` file check.

## 0.2.0 — 2026-07-17

Complete rebuild: from a thin CLI wrapper into a self-extending toolkit.

### Added

- **MCP bridge**: one long-lived `sema mcp` child; all server tools registered as native
  `sema_*` Pi tools (hand-rolled line-delimited JSON-RPC client, schema pass-through,
  glob-aware exclusion, crash auto-restart).
- **Forge / self-extension**: `create_sema_tool` + `/sema:forge` — strict-sandbox
  `--no-llm` verification probe with `(tool? …)` assertion, single approval gate,
  tiered storage, live injection, live registration (callable next turn).
- **Workflows**: `submit_sema_workflow` + `/sema:workflow` (static `workflow check`
  gating on error-level diagnostics, shape preview, confirm-before-run) and
  `sema_workflow_run` (journal tailer with resume-segment merge, streaming partial
  results, live status widget, needs-auth and resume handling).
- **Dashboard**: `/sema:workflows` + shortcut — runs overlay with live tail and
  phase/agent drill-down.
- Tiered library storage under `~/.pi/agent/pi-sema/` and `<project>/.pi/pi-sema/`
  (tools, workflows, agents kept separate).
- Layered config (global file → project file → CLI flags), `sema:` command prefix.
- 70+ unit/integration tests, incl. live tests against the real `sema` binary.

### Changed

- All sema invocations moved to `spawnSema` (`node:child_process`) with caller-enforced
  timeouts — sema's own `--timeout` flag is a parsed no-op.
- System-prompt Sema reference now scans for `.sema` files in pure Node (no `fd`/`find`),
  cached per cwd.

### Removed

- The 4 static tools (`sema_eval`/`sema_fmt`/`sema_build`/`sema_compile` as execSync
  wrappers) — superseded by the bridge.
- The `/sema-run`, `/sema-fmt`, `/sema-build` slash commands.
- Dead `src/mcp.ts`.

### Fixed

- Failing commands with stdout no longer misreported as success (exit-code bug in the
  old `runSemaAsync`).
- AbortSignal is honored everywhere (tool calls, probes, workflow runs).
- TUI no longer blocks on long operations (no more execSync in command handlers).

## 0.1.0 — 2026-07-17

Initial agent-generated extension: static eval/fmt/build/compile tools, three slash
commands, system-prompt Sema reference injection.
