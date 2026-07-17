# pi-sema — a self-extending Sema toolkit for Pi

**[Sema](https://sema-lang.com) support for the [Pi coding agent](https://pi.dev) — and a
self-extension loop: the agent forges its own persistent Sema tools mid-session.**

[![CI](https://github.com/sema-lisp/pi-sema/actions/workflows/ci.yml/badge.svg)](https://github.com/sema-lisp/pi-sema/actions)
[![npm](https://img.shields.io/npm/v/@sema-lang/pi-sema)](https://www.npmjs.com/package/@sema-lang/pi-sema)
[![License](https://img.shields.io/github/license/sema-lisp/pi-sema?color=c8a855)](LICENSE)

Pi has no built-in MCP client and no sub-agents — pi-sema bridges Sema's MCP server into
native Pi tools and layers three things on top:

1. **The bridge** — one long-lived `sema mcp` process; every server tool becomes a native
   `sema_*` Pi tool (eval, run_file, fmt, docs_search, …). The server recomputes its tool
   list from the live environment on every call, which makes the next part possible.
2. **The forge** — `/sema:forge <description>` (or the agent deciding on its own via the
   `create_sema_tool` tool): the model writes a `(deftool …)`, it is verified in a strict
   sandbox with no LLM/shell/network access, shown to you for approval, stored in a tiered
   library, injected into the live server, and registered as a Pi tool — **callable on the
   very next turn**. No restart, no reload.
3. **Workflows** — `/sema:workflow <description>` authors a journaled, resumable, budgeted
   `defworkflow` (statically validated, previewed, confirm-before-run), then runs it with a
   **live status widget** (phases, agents, token/cost budget) streamed from the run journal.
   `/sema:workflows` opens a dashboard overlay of all runs, live and historical.

## Install

```bash
pi install npm:@sema-lang/pi-sema
```

Or from a checkout: `npm install && npm run build && pi install /path/to/pi-sema`, then
`/reload` inside Pi.

Requires the `sema` binary on PATH:

```bash
curl -fsSL https://sema-lang.com/install.sh | sh
# or: cargo install sema-lang   # or: brew install helgesverre/tap/sema-lang
```

## Commands

| Command | Description |
| --- | --- |
| `/sema:forge <desc>` | Forge a persistent Sema tool from a description (generate → verify → approve → store → live-register) |
| `/sema:workflow <desc>` | Author a Sema workflow (generate → static check → preview → approve → store → run) |
| `/sema:workflows` | Runs dashboard overlay (also on `ctrl+alt+s`): live + historical, phase/agent drill-down |
| `/sema:tools` | List bridged + forged tools; `refresh` re-syncs from the server |

Tools and workflows are deliberately **separate things**: separate storage, separate
commands, separate flows.

## Agent-facing tools

| Tool | Description |
| --- | --- |
| `sema_eval`, `sema_run_file`, `sema_fmt`, `sema_docs`, `sema_docs_search`, … | Bridged sema MCP defaults |
| `sema_<name>` | Every forged/library tool, live-registered |
| `create_sema_tool` | The self-extension loop (the agent can forge unprompted) |
| `submit_sema_workflow` | Validate + store an authored workflow |
| `sema_workflow_run` | Run a library workflow with live status; resumable via `resume=<run_id>` |

## Storage

Tiered, following Pi's conventions — project shadows global by name:

```
~/.pi/agent/pi-sema/{tools,workflows,agents}/   # global tier + config.json
<project>/.pi/pi-sema/{tools,workflows,agents}/ # project tier (travels with the repo)
```

Stored tools load into the bridge at session start (filepath mode); forging inserts live.

## Configuration

`~/.pi/agent/pi-sema/config.json`, overridden by `<project>/.pi/pi-sema/config.json`,
overridden by CLI flags (`pi --sema-sandbox=… --sema-exclude=… --sema-budget=…`):

```jsonc
{
  "sandbox": { "mcp": "all", "workflows": "all" },  // "all" = allow everything (default)
  "excludeTools": ["notebook/*"],                    // hidden from Pi (globs ok)
  "library": { "defaultTier": "project" },
  "forge": { "maxRounds": 3, "probeTimeoutMs": 15000 },
  "workflows": { "defaultBudgetUsd": null, "runDir": null },
  "ui": { "dashboardShortcut": "ctrl+alt+s" }
}
```

### Sandboxing

Forge **verification** always runs under `--sandbox strict --no-llm`. **Execution** is
unsandboxed by default (`"all"`) — that is what makes forged tools useful — with the
approval dialog as the human gate. Setting `sandbox.mcp` to `"strict"` or a capability
list (`"no-shell,no-fs-write"`) requires a sema build whose `sema mcp` accepts
`--sandbox` (sema > 1.30); pi-sema feature-detects and warns when it can't comply.

## Development

```bash
npm install
npm run check   # typecheck
npm test        # vitest — live sema integration tests auto-skip without the binary
npm run build
```

`docs/research/` holds the verified research this design is built on;
`docs/manual-test-checklist.md` covers the TUI-only surface.

## Links

- [Sema Website](https://sema-lang.com) · [Docs](https://sema-lang.com/docs) · [Playground](https://sema.run)
- [Sema MCP server](https://sema-lang.com/docs/mcp) · [Workflows](https://sema-lang.com/docs/llm/workflows)
- [Pi extension docs](https://pi.dev/docs/latest/extensions)

## License

MIT © [Helge Sverre](https://github.com/HelgeSverre)
