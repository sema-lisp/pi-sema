# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`@sema-lang/pi-sema` is a **Pi coding-agent extension** (not a Sema library). It bridges
Sema's MCP server into native Pi tools and layers a self-extension loop on top: the agent
forges its own persistent Sema tools and runs journaled workflows mid-session. This repo is a
member of the `sema-lisp/workspace` meta-repo — the workspace root `CLAUDE.md` (worktree,
disk-hygiene, and per-member commit rules) still applies here.

## Commands

Everything runs through `npm`/`vitest`; `jake` recipes wrap the same scripts (namespaced
`jake pi.*` from the workspace root).

```bash
npm run build        # tsc → dist/   (jake pi.build — incremental, no-op if unchanged)
npm run check        # tsc --noEmit  (jake pi.typecheck)
npm run dev          # tsc --watch
npm test             # vitest run    (jake pi.test)
npm test -- test/forge.test.ts        # single file
npm test -- -t "self-extension"       # single test by name
npm run format       # prettier --write
jake pi.install      # build + `pi install .` — run the local build inside Pi
jake pi.dev          # build + install + launch pi here
```

- **Never `bun test`** — bun's vitest shim is incomplete and `test/bun-guard.ts` (preloaded
  via `bunfig.toml`) fails fast. Use `npm test` / `bun run test`.
- **Live integration tests auto-skip without the `sema` binary** via
  `describe.skipIf(!semaAvailable())` (`test/mcp-live.test.ts`, `workflow-live.test.ts`). They
  shell out to the real `sema mcp` / `sema workflow run`. Everything else is pure and runs
  anywhere.
- The **`sema` binary must be on PATH** for the extension to do anything at runtime; the
  extension degrades gracefully (notifies and no-ops) when it's missing.

## Architecture

`src/index.ts` is the extension entrypoint (`export default function (pi: ExtensionAPI)`). On
`session_start` it builds session-scoped `runtime = { cfg, store, bridge }` (rebuilt each
session so cwd/config changes are honored), then registers commands, tools, hooks, and the
dashboard. Everything reaches runtime through the `getRuntime()` closure — there is no global
state.

Three subsystems, deliberately **separate** (separate storage dirs, commands, and flows —
never conflate tools vs workflows vs agents):

### 1. The bridge (`src/bridge/`)

`SemaBridge` owns one long-lived `sema mcp` child process (`process.ts`, JSON-RPC over stdio
in `jsonrpc.ts`). Every MCP tool becomes a native `sema_*` Pi tool. The linchpin fact the
whole design rests on: **`sema mcp` recomputes `tools/list` from the live env on every call**,
so a `(deftool …)` injected via `eval` appears with no restart or `listChanged` notification.
`refresh()` diffs the list and registers new tools; when an `eval` call contains `(deftool …)`
the bridge auto-`refresh()`es so the agent can call what it just defined next turn.
`schema.ts` sanitizes MCP JSON Schemas into Pi-tool params and maps MCP names → `sema_*` Pi
names. `run_file` gets a **dedicated isolated subprocess** (not the shared stdio channel) so a
crashing/flooding script can't take the bridge down.

### 2. The forge (`src/forge/`)

`create_sema_tool` (the agent can call it unprompted; `/sema:forge` is the human entry). The
pipeline: **generate → verify → approve → store → live-inject → register**.

- `probe.ts` verifies candidate source under `--sandbox strict --no-llm` (the **only** place
  those flags are used) and asserts the tool registered via `(tool? name)`. It force-resolves
  every slash-namespaced symbol as a bare top-level expr because **Sema resolves free
  variables at call time** — an unbound stdlib name would otherwise only explode on first real
  use, not at deftool time.
- Verification runs sandboxed; **real execution is unsandboxed by default** (`sandbox: "all"`)
  — that is what makes forged tools useful. The `ctx.ui.confirm` approval dialog is the human
  gate. Failed probes retry up to `forge.maxRounds` (default 3) with the exact diagnostic fed
  back to the model.

### 3. Workflows (`src/workflows/`)

`sema_workflow_run` / `submit_sema_workflow` (`/sema:workflow` authors, `/sema:workflows`
opens the dashboard). Runs shell out to `sema workflow run --run-dir … --no-auth-prompt`.

- `journal.ts` `JournalTailer` polls the run journal (JSONL); `model.ts` `reduceRun` folds
  events into `RunState`; `ui/format.ts` + `ui/dashboard.ts` render the live status widget and
  overlay. Runs are **journaled and resumable** — `resume=<run_id>` replays memoized steps for
  free after a failure. `author.ts`/`check.ts` statically validate authored `defworkflow`
  source before storing.

### Storage & config

- `src/library/store.ts` + `src/paths.ts`: **tiered store**, project shadows global by name.
  Project tier `<cwd>/.pi/pi-sema/{tools,workflows,agents}/`; global tier
  `~/.pi/agent/pi-sema/…`. Dirs are created lazily on first write (session start must not
  scatter dirs into repos). Stored tool files are passed to `sema mcp` as filepath args at
  start; forging injects live in addition.
- `src/config.ts`: layered config — `DEFAULT_CONFIG` ← global `config.json` ← project
  `config.json` ← CLI flags (`--sema-sandbox`, `--sema-exclude`). Never
  throws; malformed config warns and is ignored.
- `src/sema.ts`: `spawnSema` is the single subprocess helper. Note sema's own `--timeout` flag
  is a **no-op** — timeouts/abort are enforced here in Node.

### Hooks & resources

`src/hooks/context.ts` injects the Sema cheat sheet into the system prompt when the cwd has
`.sema` files. The package ships (see `package.json` `pi` field): the `sema` theme
(`themes/`), the `/skill:sema` authoring reference (`skills/sema/SKILL.md`, progressive
disclosure), and `/sema-review` + `/sema-scratch` prompts (`prompts/`).

## Conventions

- **ESM with `.js` import specifiers** (`import … from "./sema.js"`) resolving to `.ts`
  sources — required by the `"module"`/`tsc` setup. Keep the `.js` suffix on every relative
  import.
- Tool params use **`typebox`** (`Type.Object({...})`) for forge/workflow tools; bridged tools
  reuse the MCP `inputSchema` through `sanitizeSchema`.
- Tool `execute` returns `AgentToolResult`; build results with `toolText` / `toolError` from
  `src/tool-result.ts` rather than hand-writing the `{ content: [...], details }` literal.
  Small shared helpers (`tryParseJson`, `readJsonFile`, `formatLineCol`, `extractSingleFormName`)
  live in `src/util.ts`. Tool result text often carries **agent-directed instructions** (e.g.
  "callable from your NEXT turn", "resume with resume=…") — that phrasing is load-bearing, not
  decorative.
- `docs/research/` holds the verified research the design rests on; `docs/ideas/` are scoped
  feature proposals; `docs/manual-test-checklist.md` covers the TUI-only surface that vitest
  can't reach.
