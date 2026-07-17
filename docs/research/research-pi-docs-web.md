KEY FACTS:

- Pi repo is github.com/badlogic/pi-mono (aliased to earendil-works/pi); npm package repository field = git+https://github.com/earendil-works/pi.git, directory packages/coding-agent (local package.json:89-92); researched version 0.79.10 (CHANGELOG.md, 2026-06-22)
- Pi has NO native MCP: README states 'No MCP. Build CLI tools with READMEs (see Skills), or build an extension that adds MCP support' linking https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/; docs/usage.md:306 lists MCP, sub-agents, plan mode, to-dos as intentionally excluded
- De-facto MCP bridge today: community npm package pi-mcp-adapter v2.11.0 by nicopreme (github.com/nicobailon/pi-mcp-adapter, ~~129K downloads/mo, top of pi.dev/packages) — single ~~200-token `mcp` proxy tool with search/invoke, lazy server lifecycle, stdio+StreamableHTTP/SSE, OAuth, reads .mcp.json//~~/.config/mcp/mcp.json/~~/.pi/agent/mcp.json/.pi/mcp.json, supports MCP sampling through Pi models and elicitation via Pi dialogs
- Extension UI API: ctx.ui.custom((tui,theme,keybindings,done)=>Component, {overlay:true, overlayOptions:{anchor,width:'50%',margin,row/col,visible(fn)}, onHandle}) for floating overlays; setWidget(key, lines|factory, {placement:'aboveEditor'|'belowEditor'}), setFooter/setHeader/setStatus/setTitle/setEditorComponent/setWorkingIndicator (docs/extensions.md:2270-2464, docs/tui.md:109-190)
- Custom renderers: pi.registerMessageRenderer(customType, fn) + pi.sendMessage({customType,...},{triggerTurn,deliverAs}); pi.registerEntryRenderer + pi.appendEntry for session-persisted custom entries; per-tool renderCall/renderResult; streaming via onUpdate in execute(toolCallId, params, signal, onUpdate, ctx)
- Flagship rendering demo: examples/extensions/doom-overlay/ runs DOOM as a TUI overlay at 35 FPS; also snake.ts, space-invaders.ts, tic-tac-toe.ts, plan-mode/, todo.ts, custom-footer.ts, overlay-qa-tests.ts (examples/extensions/README.md)
- resources_discover event fires after session_start with reason 'startup'|'reload'; handler returns {skillPaths, promptPaths, themePaths} — working example examples/extensions/dynamic-resources/index.ts (docs/extensions.md:365-380)
- Skills follow the Agent Skills standard (agentskills.io): SKILL.md with name/description frontmatter, progressive disclosure into system prompt, /skill:name commands; pi deliberately does not require name==parent-dir; loaded from ~/.pi/agent/skills, ~/.agents/skills, .pi/skills, .agents/skills (trust-gated), packages, settings (can point at ~/.claude/skills), --skill (docs/skills.md)
- Pi packages bundle extensions+skills+prompts+themes via package.json 'pi' key or convention dirs, keyword 'pi-package' lists them on the pi.dev/packages gallery; pi install npm:|git:|https|local; peerDeps '*' required for @earendil-works/pi-ai/pi-agent-core/pi-coding-agent/pi-tui/typebox (docs/packages.md)
- pi.registerTool() takes effect immediately at any time mid-session (examples/extensions/dynamic-tools.ts registers tools from a /add-echo-tool command); pi.getActiveTools/getAllTools/setActiveTools manage the active set
- /reload hot-reloads extensions/skills/prompts/themes for auto-discovered locations (~/.pi/agent/extensions/, .pi/extensions/); ctx.reload() does the same programmatically (session_shutdown reason 'reload' → session_start + resources_discover reason 'reload'); documented pattern lets the LLM trigger reload via a reload_runtime tool that queues a /reload-runtime command (docs/extensions.md:7, 1226-1268; examples/extensions/reload-runtime.ts)
- Notable ecosystem packages (pi.dev/packages): pi-subagents ~112K/mo, @quintinshaw/pi-dynamic-workflows (100s of subagents, worktree isolation, cost accounting) ~25K/mo, @mjasnikovs/pi-task (crash-safe pipelines, remote web view) ~20K/mo, pi-crew ~15K/mo, context-mode ~114K/mo; GitHub collections kcosr/pi-extensions (apply_patch, SQLite tool auditing) and drew-myers/pi-extensions; sessions sharing via badlogic/pi-share-hf

# Pi Coding Agent — Extension System, MCP, Resources, Ecosystem Research

Primary sources: local installed package `@earendil-works/pi-coding-agent@0.79.10` at `/Users/helge/code/sema/pi-sema/node_modules/@earendil-works/pi-coding-agent` (its `docs/` and `examples/` ship with the npm package and mirror pi.dev), https://pi.dev/docs/latest/extensions, https://pi.dev/packages, npm registry, GitHub. Repo: **https://github.com/badlogic/pi-mono** (redirects/aliases to `earendil-works/pi`; `package.json` repository = `git+https://github.com/earendil-works/pi.git`, directory `packages/coding-agent`). Author: Mario Zechner (badlogic).

## 1. Rich TUI UI from extensions

Extensions are TypeScript modules exporting `export default function (pi: ExtensionAPI)` (may be async; async init completes before `session_start`/`resources_discover`). Docs: https://pi.dev/docs/latest/extensions and https://pi.dev/docs/latest/tui (local: `docs/extensions.md`, `docs/tui.md`).

### UI API surface (`ctx.ui`)

- Blocking dialogs: `confirm(title, msg)`, `select(title, items)`, `input(title, prompt)`, `editor(title, content)` — work in TUI **and** RPC modes (`ctx.hasUI` guard); `custom()` is TUI-only (`ctx.mode === "tui"` guard) — `docs/extensions.md:896-900`.
- Non-blocking chrome: `notify(msg, level)`, `setStatus(key, text)` (footer), `setWidget(key, lines | (tui, theme) => Component, { placement: "aboveEditor" | "belowEditor" })` (`docs/extensions.md:2284-2288`), `setTitle(text)`, `setEditorText(text)`, `setFooter((tui, theme) => ...)` / `setFooter(undefined)` restores built-in (`docs/extensions.md:2291-2295`), `setHeader(...)`, `setWorkingIndicator({ frames })` (`docs/extensions.md:2270-2281`), `setWorkingMessage`, `setWorkingVisible`, `setHiddenThinkingLabel`, `setEditorComponent((tui, theme, keybindings) => new VimEditor(...))` to replace the whole editor (`docs/extensions.md:2336-2341`).
- **Full custom components**: `ctx.ui.custom<T>((tui, theme, keybindings, done) => Component, options)` temporarily replaces the editor until `done(result)` is called (`docs/extensions.md:2403`).
- **Overlays (experimental)**: `ctx.ui.custom(factory, { overlay: true, overlayOptions })` renders a floating modal over existing content without clearing the screen. `OverlayOptions`: `width/minWidth/maxHeight` (number or `"50%"`), `anchor` (9 positions e.g. `"right-center"`, `"top-right"`, default `"center"`), `offsetX/offsetY`, `row/col` (absolute or %), `margin`, responsive `visible: (termWidth, termHeight) => boolean`. `onHandle(handle)` gives `handle.focus()`, `unfocus({target})`, `setHidden(bool)`, `hide()` for programmatic focus/visibility/stacking (`docs/tui.md:109-190`, `docs/extensions.md:2433-2464`).
- TUI building blocks from `@earendil-works/pi-tui`: `Text`, `Box`, `Container`, `Spacer`, `Markdown`, `Image`, plus a `Component` interface and Focusable/IME support for custom components (`docs/tui.md:189-330`). Doc covers invalidation/theme-change patterns and performance (`docs/tui.md:463-593`) and common patterns: SelectList dialog, async-with-cancel BorderedLoader, settings toggles, persistent status indicator, widgets above/below editor, custom footer, custom editor (vim mode).

### Live-updating renderers

- **Custom message renderers** (participate in LLM context): `pi.registerMessageRenderer(customType, (message, {expanded}, theme) => Component)` + `pi.sendMessage({ customType, content, display: true }, { triggerTurn, deliverAs: "steer"|"followUp"|"nextTurn" })` (`docs/extensions.md:1511`).
- **Custom entry renderers** (session-only, not sent to LLM): `pi.registerEntryRenderer("status-card", (entry, {expanded}, theme) => Component)` + `pi.appendEntry("status-card", data)` — durable, replayed on resume.
- **Per-tool rendering**: tool definitions take `renderCall(args, theme, context)` and `renderResult(result, options, theme, context)`; overriding built-in tools inherits rendering per-slot if omitted.
- Streaming tool progress: `execute(toolCallId, params, signal, onUpdate, ctx)` — call `onUpdate?.({content:[...]})` to live-update the tool cell; `tool_execution_start/update/end` events on the consumer side.

### Real example extensions doing custom rendering (all in `examples/extensions/`, also at https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions/)

- `doom-overlay/` — **DOOM running as an overlay at 35 FPS**, real-time game rendering, WASD input, auto-downloads shareware WAD (`examples/extensions/doom-overlay/README.md`).
- `snake.ts`, `space-invaders.ts`, `tic-tac-toe.ts` (agent plays via `executionMode: "sequential"` tools) — games with custom UI + keyboard handling + session persistence.
- `overlay-test.ts`, `overlay-qa-tests.ts` — anchors, margins, stacking, overflow, animation QA.
- `todo.ts` — todo tool + `/todos` command, custom rendering + state persistence (long-running task status pattern).
- `plan-mode/` — Claude-Code-style plan mode with step tracking using "All event types, registerCommand, registerShortcut, registerFlag, setStatus, setWidget, sendMessage, setActiveTools" (`docs/extensions.md:2656`).
- `custom-footer.ts` (git branch + token stats), `custom-header.ts`, `widget-placement.ts` (above/below editor), `status-line.ts` (turn progress in footer), `modal-editor.ts` (vim-like custom editor), `rainbow-editor.ts` (animated), `titlebar-spinner.ts`, `working-indicator.ts`, `questionnaire.ts` (tab-bar multi-question UI), `built-in-tool-renderer.ts` / `minimal-mode.ts` (re-render built-in tools), `message-renderer.ts`, `summarize.ts` (transient UI), `interactive-shell.ts` (full-terminal vim/htop via `user_bash` hook).
- Overlay lifecycle rule: components are disposed on close; recreate rather than reuse instances (`docs/tui.md:166-188`).

## 2. MCP support

**Pi has NO native MCP.** README (`README.md`, also https://pi.dev): "**No MCP.** Build CLI tools with READMEs (see Skills), or build an extension that adds MCP support." Links Mario's rationale post: https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/. `docs/usage.md:306`: "It intentionally does not include built-in MCP, sub-agents, permission popups, plan mode, to-dos, or background bash. You can build or install those workflows as extensions or packages."

**How people connect MCP servers today: the community extension `pi-mcp-adapter`** (npm, v2.11.0, author nicopreme / Nico Bailon, repo https://github.com/nicobailon/pi-mcp-adapter, ~129K downloads/mo — the top package on pi.dev/packages). Install: `pi install npm:pi-mcp-adapter`. Design:

- **One proxy tool `mcp` (~200 tokens)** instead of registering every MCP tool: `mcp({ search: "screenshot" })` to discover, `mcp({ tool: "chrome_devtools_take_screenshot", args: '{"format":"png"}' })` to invoke (args is a JSON string). "Two calls instead of 26 tools cluttering the context."
- Reads standard MCP config files with precedence: `~/.config/mcp/mcp.json` → `~/.pi/agent/mcp.json` (Pi global override) → `.mcp.json` (project) → `.pi/mcp.json` (Pi project override). `/mcp setup` imports host configs from Cursor/Claude Code/Codex; `pi-mcp-adapter init` CLI also available.
- Transports: stdio (`command`/`args`/`env`/`cwd`) and HTTP (`url`, StreamableHTTP with SSE fallback), `auth: "bearer"|"oauth"` incl. dynamic client registration, client_credentials, and remote/headless OAuth via `mcp({action:"auth-start"...})` / `auth-complete`.
- Lifecycle: `lazy` (default — connect on first call, idle disconnect, cached tool metadata keeps search/describe offline), `eager`, `keep-alive`. Settings: `directTools` (register selected tools individually instead of via proxy), `disableProxyTool`, `excludeTools`, `outputGuard` (maxBytes/maxLines), **MCP sampling through Pi models** (`sampling`, `samplingAutoApprove`) and **elicitation via Pi dialogs**.
- Other MCP-adjacent packages on pi.dev/packages: `context-mode` (mksglu, ~114K/mo, context-window-saving MCP plugin spanning Claude Code/Gemini CLI/Copilot/OpenCode/Codex), `pi-shazam` (gjczone, codebase analysis toolkit with MCP mode).

## 3. Skills / prompts / themes resource system

Three declarative resource types plus extensions; all four are bundled by **pi packages** (https://pi.dev/docs/latest/packages, `docs/packages.md`).

### Skills (`docs/skills.md`, https://pi.dev/docs/latest/skills)

- Pi implements the **Agent Skills standard** (https://agentskills.io/specification), leniently — warns on most violations; notably does NOT require skill name == parent dir name (deliberate deviation for shared skill dirs).
- Format: directory with `SKILL.md` (YAML frontmatter: required `name` ≤64 chars lowercase/hyphen, required `description` ≤1024 chars; optional `license`, `compatibility`, `metadata`, `allowed-tools` (experimental), `disable-model-invocation`). Missing description ⇒ skill not loaded. Freeform `scripts/`, `references/`, `assets/`.
- Locations: `~/.pi/agent/skills/`, `~/.agents/skills/`, project `.pi/skills/` and `.agents/skills/` (walking ancestors to git root; project ones require trust), package `skills/` dirs or `pi.skills` in package.json, `skills` array in settings (interop: point at `~/.claude/skills`, `~/.codex/skills`), `--skill <path>`; `--no-skills` disables discovery.
- Mechanics: progressive disclosure — startup scan puts name+description into the system prompt in the standard's XML form; agent `read`s full SKILL.md on demand; `/skill:name [args]` forces load (args appended as `User: <args>`), gated by `enableSkillCommands`.
- Skill repos: https://github.com/anthropics/skills, https://github.com/badlogic/pi-skills (web search, browser automation, Google APIs, transcription).

### Prompt templates (`docs/prompt-templates.md`)

Markdown files; filename becomes `/name` slash command. Frontmatter: optional `description`, `argument-hint` (`<required>` / `[optional]` shown in autocomplete). Locations: `~/.pi/agent/prompts/`, `.pi/prompts/` (trusted), package `prompts/` or `pi.prompts`, settings `prompts`, `--prompt-template`.

### Themes (`docs/themes.md`)

JSON color-token files. Built-in `dark`/`light`; loaded from `~/.pi/agent/themes/`, `.pi/themes/` (trusted), package `themes/` or `pi.themes`, settings, `--theme`. Selected via `/settings` or `settings.json` `"theme"`.

### `resources_discover` — how extensions contribute resources (`docs/extensions.md:365-380`)

Fired after `session_start`, `reason: "startup" | "reload"`; handler returns `{ skillPaths, promptPaths, themePaths }` (absolute file or directory paths). Startup order: `project_trust` → `session_start` → `resources_discover`. Working example `examples/extensions/dynamic-resources/index.ts` — returns `skillPaths: [join(baseDir,"SKILL.md")]`, `promptPaths: [dynamic.md]`, `themePaths: [dynamic.json]`.

### Packages (`docs/packages.md`)

- `pi install npm:@foo/bar@1.0.0 | git:github.com/user/repo@v1 | https://... | /local/path`; `pi remove/list/update [--all|--extensions|--self]`; `-l` writes to project `.pi/settings.json` (team-shared, auto-installed after trust); `pi -e <pkg>` for ephemeral try-out.
- Manifest: `package.json` `"pi": { "extensions": [...], "skills": [...], "prompts": [...], "themes": [...], "video", "image" }` + keyword `"pi-package"` for the https://pi.dev/packages gallery. Convention dirs (`extensions/`, `skills/`, `prompts/`, `themes/`) auto-discovered if no manifest. Glob + `!exclusion` patterns; settings-side per-package filtering with `+path`/`-path` force include/exclude.
- Peer deps rule: `@earendil-works/pi-ai`, `pi-agent-core`, `pi-coding-agent`, `pi-tui`, `typebox` must be `peerDependencies: "*"`; other pi packages must be bundled (`bundledDependencies`). `pi config` enables/disables individual resources per scope. Project entry wins on global/project dedup.

## 4. Community ecosystem (pi.dev/packages gallery + GitHub)

Philosophy (repo README): pi is "aggressively extensible"; no built-in MCP/sub-agents/plan-mode/to-dos — all delivered as packages. Notables from https://pi.dev/packages:

- **pi-mcp-adapter** (nicopreme, ~129K/mo) — MCP bridge, see §2. Lazy server startup, on-demand tool discovery = dynamic capability surface.
- **pi-subagents** (nicopreme, ~112K/mo) — task delegation with chains + parallel execution; **@tintinweb/pi-subagents** (~40K/mo) — Claude-Code-style autonomous sub-agents; **pi-crew** (bom0792, ~15K/mo) — coordinated AI teams / async task orchestration.
- **@quintinshaw/pi-dynamic-workflows** (~25K/mo) — "fan a task out across 100s of subagents with real model routing, token/cost accounting, resume, git-worktree isolation" — the flagship long-running-status/orchestration package.
- **@mjasnikovs/pi-task** (~20K/mo) — "deterministic task planning… crash-safe /task pipelines with verify/enforce gates, real-time remote web view."
- **context-mode** (mksglu, ~114K/mo) — cross-agent context-saving MCP plugin.
- GitHub collections: https://github.com/kcosr/pi-extensions (codemap file browser, Codex-style `apply_patch` tool, SQLite tool-call auditing/approval), https://github.com/drew-myers/pi-extensions.
- Session sharing: https://github.com/badlogic/pi-share-hf (publish sessions to Hugging Face). Real-world SDK embedding: https://github.com/openclaw/openclaw (per pi README).
- First-party examples showing "advanced" patterns: `subagent/` (isolated context windows), `ssh.ts` (delegate ALL built-in tools to a remote host via pluggable `ReadOperations`/`BashOperations`... interfaces), `sandbox/` (`@anthropic-ai/sandbox-runtime` OS sandboxing), `gondolin/` (route tools into a micro-VM), `event-bus.ts` (inter-extension comms via `pi.events`), `custom-provider-anthropic/` (OAuth + custom streaming), `file-trigger.ts` (watch file, inject into conversation).

## 5. Dynamic tool registration, /reload, hot-reload

- **Tools registered via `pi.registerTool()` take effect immediately, any time** — at factory time, in `session_start`, or from a command handler mid-session. Canonical example `examples/extensions/dynamic-tools.ts`: registers `echo_session` on `session_start` and arbitrary new echo tools at runtime via `/add-echo-tool <name>`; tool defs carry `promptSnippet` (Available-tools line) and `promptGuidelines` (system-prompt guidance), so newly registered tools become promptable immediately.
- Active-set management: `pi.getActiveTools()`, `pi.getAllTools()`, `pi.setActiveTools([...])` (used by plan-mode to flip read-only). Built-ins overridable by re-registering the same name; `--no-builtin-tools` disables all. `prepareArguments(args)` hook migrates schemas for resumed sessions. `terminate: true` in a result ends the turn (structured-output pattern).
- **`/reload`**: hot-reloads extensions, skills, prompts, themes — but only for extensions in auto-discovery locations (`~/.pi/agent/extensions/`, `.pi/extensions/`, incl. `*/index.ts` subdirs); `pi -e ./path.ts` loads are for quick tests (`docs/extensions.md:7`).
- **`ctx.reload()`** (command context) programmatically runs the same flow: emits `session_shutdown` (`reason:"reload"`) for the old extension runtime, reloads resources, emits `session_start` + `resources_discover` with `reason:"reload"`. Caveats: code after `await ctx.reload()` still runs in the pre-reload module and must not trust old in-memory state — treat reload as terminal (`docs/extensions.md:1226-1250`). Tools get `ExtensionContext` (no `reload`); the documented pattern (and `examples/extensions/reload-runtime.ts`) is: register a `/reload-runtime` command that calls `ctx.reload()`, plus a `reload_runtime` tool that queues that command as a follow-up user message — i.e. **the LLM itself can trigger extension hot-reload**, enabling self-modifying setups (agent writes a new extension file, then calls `reload_runtime`).
- Session lifecycle around reload: `/new`, `/resume`, `/fork` also tear down and rebind the whole extension runtime (`session_shutdown` → reload extensions → `session_start` with reason `new|resume|fork` and `previousSessionFile`) (`docs/extensions.md:414-431`).
- Providers are also dynamic: `pi.registerProvider(name, { baseUrl, api, models | refreshModels({signal}) })` / `pi.unregisterProvider(name)` at runtime.

## Extra load-bearing API details (for synthesis)

- Event list (blockable/modifying): `project_trust` (return `{trusted, remember}`), `input` (return `{action:"continue"|"transform"|"handled", text?, images?}`), `before_agent_start` (inject message / modify systemPrompt), `tool_call` (mutate `event.input`, return `{block:true, reason}`), `tool_result` (patch `{content, details, isError}`), `context` (rewrite messages pre-LLM), `before_provider_headers/request`, `after_provider_response`, `message_start/update/end` (end can replace message), `session_before_switch/fork/compact/tree` (cancellable / custom compaction), `agent_start/end/settled`, `turn_start/end`, `model_select`, `thinking_level_select`, `user_bash`.
- Commands/shortcuts/flags: `pi.registerCommand(name, { description, getArgumentCompletions, handler(args, ctx) })`, `pi.registerShortcut("ctrl+shift+p", {...})`, `pi.registerFlag("plan", { type, default })`.
- Persistence idioms: state in tool-result `details` (branch-safe replay via `ctx.sessionManager.getBranch()`), or `pi.appendEntry(customType, data)` + reconstruction on `session_start`.
- Modes: `"tui" | "rpc" | "json" | "print"`; RPC mode supports dialogs/notify/widgets over JSON protocol (`docs/rpc.md`, `examples/rpc-extension-ui.ts`, `rpc-demo.ts`); `custom()` returns `undefined` in RPC.
- Config dirs: global `~/.pi/agent/` (settings.json, extensions/, skills/, prompts/, themes/, npm/, git/), project `.pi/` (trust-gated). Params schema via `typebox`; use `StringEnum` from `@earendil-works/pi-ai` for Google API compat. Version researched: 0.79.10 (2026-06-22).
