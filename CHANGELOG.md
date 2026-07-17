# Changelog

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
