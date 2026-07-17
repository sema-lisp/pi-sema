KEY FACTS:

- ExtensionUIContext full surface at dist/core/extensions/types.d.ts:67-191 — select/confirm/input/notify, setStatus:79, setWidget (string[] or Component factory):96-99, setFooter:106, setHeader:110, custom overlay:116-126, editor:134, addAutocompleteProvider:136, setEditorComponent:170, theme APIs:174-190
- Persistent live panels supported: setWidget keyed component factory (examples/extensions/widget-placement.ts, todo.ts), setFooter/setHeader, and ui.custom({overlay:true, overlayOptions, onHandle}) with OverlayHandle.hide/setHidden/focus and OverlayOptions.nonCapturing (pi-tui dist/tui.d.ts)
- pi-tui component model: Component { render(width): string[]; handleInput?; invalidate() }, Container, TUI extends Container with differential line rendering and requestRender(force?); components Box/Text/Markdown/Loader/SelectList/Image etc. (pi-tui dist/index.d.ts)
- registerTool works mid-session: loader.js:173-180 sets extension.tools then runtime.refreshTools() -> agent-session.js:1782 _refreshToolRegistry auto-activates new tools and rebuilds system prompt; official example examples/extensions/dynamic-tools.ts registers from a command handler
- No unregisterTool API; deactivate via pi.setActiveTools(toolNames) (types.d.ts:893, agent-session.js:550 setActiveToolsByName — takes effect next turn); ToolInfo = Pick<ToolDefinition,'name'|'description'|'parameters'|'promptGuidelines'> & {sourceInfo} (types.d.ts:1068)
- Tool execute signature types.d.ts:361: execute(toolCallId, params, signal, onUpdate: AgentToolUpdateCallback|undefined, ctx); AgentToolResult<T> = {content, details, terminate?} (pi-agent-core types.d.ts:305); onUpdate streams partials -> tool_execution_update event + renderResult(..., {isPartial:true}, theme, ToolRenderContext) (types.d.ts:299-331,363-365)
- No built-in MCP: only grep hit in dist/ is vendor/highlight.min.js; docs/usage.md:306 states pi intentionally omits built-in MCP/sub-agents; registerProvider (types.d.ts:954) is for LLM model providers only — MCP must be bridged by an extension registering tools dynamically
- resources_discover (types.d.ts:393-403) returns {skillPaths, promptPaths, themePaths}; defaults are ~/.pi/agent/skills|prompts and <cwd>/.pi/skills|prompts (resource-loader.js:566-573, CONFIG_DIR_NAME='.pi' config.js:394); skills follow Agent Skills SKILL.md standard (dist/core/skills.d.ts)
- before_agent_start result can replace systemPrompt per turn (types.d.ts:499-509,768-772); tool_call handler can block ({block, reason}) or mutate event.input in place (types.d.ts:619-661,747-751); appendEntry(customType, data) persists session state not sent to LLM (types.d.ts:879)
- pi.exec(command, args, {signal?, timeout?, cwd?}) -> {stdout, stderr, code, killed} (dist/core/exec.d.ts, API at types.d.ts:887) — managed exec with AbortSignal cancellation
- pi-sema src usage is minimal: 4 static registerTools + 3 commands (src/index.ts), before_agent_start system-prompt append (src/hooks/context.ts), empty resources_discover stub (src/hooks/resources.ts), stub src/mcp.ts; uses node execSync instead of pi.exec

# Pi Coding Agent Extension SDK — deep dive

Paths (all under `PKG = /Users/helge/code/sema/pi-sema/node_modules/@earendil-works/pi-coding-agent`):

- Main types: `PKG/dist/core/extensions/types.d.ts` (1208 lines, "T:" below)
- Public exports: `PKG/dist/index.d.ts`
- pi-tui (nested): `PKG/node_modules/@earendil-works/pi-tui/dist/` ("TUI:" below)
- pi-agent-core (nested): `PKG/node_modules/@earendil-works/pi-agent-core/dist/types.d.ts` ("AC:")
- Current usage: `/Users/helge/code/sema/pi-sema/src/`

Extension model: default-export a factory `export type ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>` (T:1037). `ExtensionAPI` (T:816–971) has `on(...)` overloads for every event + registration/action methods. Event handlers get `(event, ctx: ExtensionContext)`.

## 1. UI surface

### ExtensionUIContext (T:67–191) — full member list

```ts
select(title: string, options: string[], opts?: ExtensionUIDialogOptions): Promise<string | undefined>   // T:69
confirm(title: string, message: string, opts?): Promise<boolean>                                          // T:71
input(title: string, placeholder?: string, opts?): Promise<string | undefined>                            // T:73
notify(message: string, type?: "info" | "warning" | "error"): void                                        // T:75
onTerminalInput(handler: TerminalInputHandler): () => void        // raw stdin tap, interactive only, T:77
setStatus(key: string, text: string | undefined): void            // footer/status bar segment, T:79
setWorkingMessage(message?: string): void                                                                 // T:81
setWorkingVisible(visible: boolean): void                                                                 // T:83
setWorkingIndicator(options?: WorkingIndicatorOptions): void      // {frames?: string[], intervalMs?}, T:92
setHiddenThinkingLabel(label?: string): void                                                              // T:94
setWidget(key: string, content: string[] | undefined, options?: ExtensionWidgetOptions): void             // T:96
setWidget(key: string, content: ((tui: TUI, theme: Theme) => Component & {dispose?(): void}) | undefined, options?): void // T:97-99
setFooter(factory: ((tui, theme, footerData: ReadonlyFooterDataProvider) => Component & {dispose?}) | undefined): void // T:106
setHeader(factory: ((tui, theme) => Component & {dispose?}) | undefined): void                            // T:110
setTitle(title: string): void                                     // terminal window title, T:114
custom<T>(factory: (tui, theme, keybindings, done: (result: T) => void) => Component | Promise<Component>,
          options?: { overlay?: boolean; overlayOptions?: OverlayOptions | (() => OverlayOptions);
                      onHandle?: (handle: OverlayHandle) => void }): Promise<T>                           // T:116-126
pasteToEditor(text: string): void; setEditorText(text): void; getEditorText(): string                     // T:128-132
editor(title: string, prefill?: string): Promise<string | undefined>   // multi-line editor dialog, T:134
addAutocompleteProvider(factory: AutocompleteProviderFactory): void    // wraps current provider, T:136 (type T:61)
setEditorComponent(factory: EditorFactory | undefined): void           // replace input editor (Vim example in jsdoc), T:170
getEditorComponent(): EditorFactory | undefined                                                           // T:172
readonly theme: Theme; getAllThemes(); getTheme(name); setTheme(theme): {success, error?}                 // T:174-186
getToolsExpanded(): boolean; setToolsExpanded(expanded: boolean): void                                    // T:188-190
```

- `ExtensionUIDialogOptions` (T:35–40): `{ signal?: AbortSignal; timeout?: number }` — timeout auto-dismisses with live countdown.
- `WidgetPlacement = "aboveEditor" | "belowEditor"` (T:42); `ExtensionWidgetOptions = { placement?: WidgetPlacement }` (T:44–47, default aboveEditor).
- `EditorFactory = (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent` (T:62).

### Persistent live-updating panel: YES, three ways

1. **`setWidget(key, componentFactory)`** — keyed, persists until set to `undefined`; the factory returns a live `Component` whose state you mutate then call `tui.requestRender()`. Example: `examples/extensions/widget-placement.ts`, `todo.ts`. Best fit for workflow step status.
2. **`setFooter` / `setHeader`** — replace whole footer/header with a component (`examples/extensions/custom-footer.ts` calls `footerData.onBranchChange(() => tui.requestRender())`).
3. **`ui.custom(..., { overlay: true, overlayOptions, onHandle })`** — a floating overlay via `TUI.showOverlay`; `OverlayOptions` (TUI tui.d.ts) supports `width/minWidth/maxHeight` (number or `"50%"`), `anchor` (9 positions), `row/col`, `offsetX/Y`, `margin`, `visible(termW,termH)`, and `nonCapturing: true` (doesn't grab keyboard — so a non-modal live overlay is possible). `OverlayHandle`: `hide() / setHidden(bool) / isHidden() / focus() / unfocus() / isFocused()`. Note `custom()` returns a Promise resolved by `done(result)` — for a persistent panel just never call `done` or keep the handle via `onHandle`. Games in examples (`snake.ts`, `space-invaders.ts`, `doom-overlay`) prove long-lived interactive overlays.

Custom message renderers: `pi.registerMessageRenderer<T>(customType: string, renderer: MessageRenderer<T>)` (T:865); `MessageRenderer<T> = (message: CustomMessage<T>, options: {expanded: boolean}, theme: Theme) => Component | undefined` (T:797–800). Pairs with `pi.sendMessage({customType, content, display, details}, {triggerTurn?, deliverAs?: "steer"|"followUp"|"nextTurn"})` (T:867–870) — renders a custom entry in the chat log (persistent, part of transcript).

### pi-tui component model (TUI/tui.d.ts, TUI/components/)

- `interface Component { render(width: number): string[]; handleInput?(data: string): void; wantsKeyRelease?: boolean; invalidate(): void }` — components render to ANSI string lines; no layout engine beyond width.
- `class Container implements Component { children; addChild/removeChild/clear }`; `class TUI extends Container` does **differential rendering** (diffs previous lines vs new, minimal redraw, throttled by `MIN_RENDER_INTERVAL_MS`), `requestRender(force?)`, `start()/stop()`, `showOverlay/hideOverlay/hasOverlay`, `setFocus(component)`, `addInputListener`, Kitty-image aware, IME hardware-cursor via `CURSOR_MARKER`, OSC-11 bg color + color-scheme queries.
- Shipped components (TUI/index.d.ts): `Box(paddingX, paddingY, bgFn)` (padded/bg container), `Text(text, paddingX, paddingY, bgFn)` with `setText()` + word-wrap + caching, `Markdown` (full themed markdown incl. code highlight), `Loader` (animated spinner, `setMessage/setIndicator/start/stop`), `CancellableLoader`, `SelectList`, `SettingsList`, `Spacer`, `TruncatedText`, `Image` (Kitty/iTerm2), `Input`, `Editor`/`EditorComponent`, plus `fuzzyMatch/fuzzyFilter`, `matchesKey/parseKey/Key/KeyId`, `visibleWidth/truncateToWidth/wrapTextWithAnsi`, `CombinedAutocompleteProvider`, `AutocompleteProvider/AutocompleteItem`.
- Update loop: mutate component state → `tui.requestRender()` (or `component.invalidate()` then request); no vdom — `render(width)` re-invoked, TUI diffs output lines.

## 2. Dynamic tools

- `pi.registerTool<TParams extends TSchema, TDetails, TState>(tool: ToolDefinition<...>): void` (T:848). **Callable at any time, including mid-session**: loader.js:173–180 does `extension.tools.set(name, {definition, sourceInfo}); runtime.refreshTools()`; `refreshTools` is bound to `AgentSession._refreshToolRegistry()` (agent-session.js:1782) which rebuilds the tool registry and **auto-activates tools not previously in the registry** (agent-session.js:~1900–1909) and rebuilds the system prompt. Official example: `examples/extensions/dynamic-tools.ts` registers tools from a `/add-echo-tool` command handler at runtime. Only guard is `runtime.assertActive()` (throws if the extension instance is stale after `/reload`).
- **No `unregisterTool`** exists. Deactivation is done via `pi.setActiveTools(toolNames: string[])` (T:893) — the definition stays in the registry but is removed from the agent's live tool list.
- `getActiveTools(): string[]` (T:889); `getAllTools(): ToolInfo[]` (T:891) where `ToolInfo = Pick<ToolDefinition, "name"|"description"|"parameters"|"promptGuidelines"> & { sourceInfo: SourceInfo }` (T:1068–1070). Handler types: `GetActiveToolsHandler = () => string[]` (T:1066), `SetActiveToolsHandler = (toolNames: string[]) => void` (T:1073), `RefreshToolsHandler = () => void` (T:1074) — all part of `ExtensionActions` (T:1108–1123).
- `setActiveToolsByName` (agent-session.js:550) filters unknown names, sets `agent.state.tools`, rebuilds base system prompt; docs say "Changes take effect on the next agent turn". So **per-turn add/remove is supported**: call `setActiveTools` from `turn_start`/`before_agent_start`/`tool_result` handlers. Duplicate-name registration: last write wins within an extension (Map.set); across extensions "first registration per name wins" (runner.d.ts `getAllRegisteredTools`).

## 3. ToolDefinition / execute / streaming / rendering (T:335–366)

```ts
interface ToolDefinition<TParams extends TSchema = TSchema, TDetails = unknown, TState = any> {
  name: string; label: string; description: string;
  promptSnippet?: string;          // one-liner in "Available tools" section of system prompt
  promptGuidelines?: string[];     // bullets appended to system prompt Guidelines when active
  parameters: TParams;             // TypeBox schema
  renderShell?: "default" | "self";
  prepareArguments?: (args: unknown) => Static<TParams>;
  executionMode?: "sequential" | "parallel";   // ToolExecutionMode, AC:21
  execute(toolCallId: string, params: Static<TParams>, signal: AbortSignal | undefined,
          onUpdate: AgentToolUpdateCallback<TDetails> | undefined, ctx: ExtensionContext): Promise<AgentToolResult<TDetails>>;  // T:361
  renderCall?: (args, theme: Theme, context: ToolRenderContext<TState, Static<TParams>>) => Component;   // T:363
  renderResult?: (result: AgentToolResult<TDetails>, options: {expanded, isPartial}, theme, context) => Component;  // T:365
}
export declare function defineTool<...>(tool): ToolDefinition<...>   // T:375, preserves inference
```

- `AgentToolResult<T> = { content: (TextContent|ImageContent)[]; details: T; terminate?: boolean }` (AC:305–315). `terminate` hints early stop of the tool batch.
- `AgentToolUpdateCallback<T> = (partialResult: AgentToolResult<T>) => void` (AC:322) — scoped to the current execute; calls after settle are ignored.
- **Live progress path**: `execute` calls `onUpdate(partial)` → fires `tool_execution_update` event (T:556–562: `{toolCallId, toolName, args, partialResult}`) and the TUI re-renders the tool row: your `renderResult` is invoked with `isPartial: true` (and `ToolRenderContext.isPartial`), so a long-running tool can stream a progress panel inline in the transcript. `ToolRenderContext` (T:306–331) gives `args, toolCallId, invalidate() (redraw just this row), lastComponent (reuse), state: TState (shared across renders), cwd, executionStarted, argsComplete, isPartial, expanded, showImages, isError`. `renderShell: "self"` lets the tool draw its own framing instead of the standard colored shell. Built-in bash tool streams output the same way (see `examples/extensions/built-in-tool-renderer.ts`, `truncated-tool.ts`).
- Cancellation: `signal` is the agent-loop AbortSignal (Esc etc.).

## 4. MCP — NOT built in

- `grep -ril mcp dist/` matches only `dist/core/export-html/vendor/highlight.min.js` (false positive). No MCP client, no config surface, no types.
- Explicit in docs: `PKG/docs/usage.md:306` — "It intentionally does not include built-in MCP, sub-agents, permission popups, plan mode, to-dos, or background bash. You can build or install those workflows as extensions or packages…".
- So MCP tools reach the agent only if an extension bridges them: instantiate an MCP client (e.g. `@modelcontextprotocol/sdk`) in the extension, then `pi.registerTool` one ToolDefinition per MCP tool (dynamic registration mid-session is supported, see §2). `pi.registerProvider` (T:954) is for **model/LLM providers** (baseUrl/apiKey/models/oauth/streamSimple — ProviderConfig T:973–1003), not MCP.
- pi-sema's own `src/mcp.ts` is a stub (only a session_start notify; no actual MCP).

## 5. Lifecycle events & session persistence

Full `on()` surface (T:817–846): `project_trust, resources_discover, session_start, session_before_switch, session_before_fork, session_before_compact, session_compact, session_shutdown, session_before_tree, session_tree, context, before_provider_request, after_provider_response, before_agent_start, agent_start, agent_end, turn_start, turn_end, message_start, message_update, message_end, tool_execution_start, tool_execution_update, tool_execution_end, model_select, thinking_level_select, tool_call, tool_result, user_bash, input`.

- **resources_discover** (T:393–403): fired after session_start on `"startup" | "reload"`; handler returns `ResourcesDiscoverResult { skillPaths?: string[]; promptPaths?: string[]; themePaths?: string[] }` — extra dirs/files merged into resource loading (`DefaultResourceLoader.extendResources`, resource-loader.d.ts).
  - **Skills** = Agent Skills standard (agentskills.io): dirs containing `SKILL.md` (or loose .md files); frontmatter `{name?, description?, "disable-model-invocation"?}` (skills.d.ts `SkillFrontmatter`); injected into system prompt as XML via `formatSkillsForPrompt`; invocable as `/skill:name`. Default locations (resource-loader.js:566–573): `~/.pi/agent/skills/`, `~/.pi/agent/prompts/`, `<cwd>/.pi/skills/`, `<cwd>/.pi/prompts/` (`CONFIG_DIR_NAME = ".pi"` config.js:394; `getAgentDir() = ~/.pi/agent` config.js:417).
  - **Prompts** = prompt templates (prompt-templates.d.ts): markdown files → slash commands; `PromptTemplate {name, description, argumentHint?, content, sourceInfo, filePath}`; bash-style arg substitution `$1, $@, $ARGUMENTS, ${N:-def}, ${@:N:L}`.
- **before_agent_start** (T:499–509): `{prompt, images?, systemPrompt, systemPromptOptions: BuildSystemPromptOptions}`; result (T:768–772) `{ message?: Pick<CustomMessage,...>; systemPrompt?: string }` — per-turn system-prompt replacement, chained across extensions. (pi-sema uses this to append Sema docs: `src/hooks/context.ts`.)
- **tool_call blocking** (T:619–661, 747–751): fired before any tool executes; typed variants for built-ins (bash/read/edit/write/grep/find/ls) + `CustomToolCallEvent`; `event.input` is **mutable in place** to patch args; return `ToolCallEventResult { block?: boolean; reason?: string }` to veto. Narrow with `isToolCallEventType("bash", event)` (T:730–740). `tool_result` (T:662–702) can rewrite `{content?, details?, isError?}`.
- **Session persistence**: `pi.appendEntry<T>(customType: string, data?: T): void` (T:879) — custom entry in the session JSONL, _not_ sent to LLM (state persistence). Also `setSessionName/getSessionName` (T:881–883), `setLabel(entryId, label)` (T:885). `sessionManager: ReadonlySessionManager` on ctx; full `SessionManager` in `newSession({setup})`.
- **ExtensionFlag** (T:1042–1048): `registerFlag(name, {description?, type: "boolean"|"string", default?})` (T:857) adds a CLI flag; read with `getFlag(name)` (T:863).
- **Shortcuts** (T:852–855, ExtensionShortcut T:1049–1054): `registerShortcut(shortcut: KeyId, { description?, handler(ctx) })` — `KeyId` from pi-tui keys.ts (e.g. `"ctrl+g"`); user keybindings via `KeybindingsManager`/`AppKeybinding` (re-exported T:33) and docs/keybindings.md.
- **Commands**: `registerCommand(name, {description?, getArgumentCompletions?, handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>})` (T:850, RegisteredCommand T:801–807). `ExtensionCommandContext` (T:246–283) adds `waitForIdle, newSession, fork, navigateTree, switchSession, reload` and `getSystemPromptOptions`.
- **ExtensionContext** (T:208–241): `ui, mode ("tui"|"rpc"|"json"|"print"), hasUI, cwd, sessionManager, modelRegistry, model, isIdle(), isProjectTrusted(), signal, abort(), hasPendingMessages(), shutdown(), getContextUsage(), compact(options), getSystemPrompt()`.
- Cross-extension comms: `pi.events: EventBus` (T:970).

## 6. exec (dist/core/exec.d.ts)

```ts
interface ExecOptions { signal?: AbortSignal; timeout?: number; cwd?: string }
interface ExecResult  { stdout: string; stderr: string; code: number; killed: boolean }
pi.exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult>   // T:887
export declare function execCommand(command, args, cwd, options?): Promise<ExecResult> // also exported standalone
```

Yes — managed exec with AbortSignal cancellation + timeout; `killed: true` reports termination. (pi-sema currently does NOT use it — `src/sema.ts` shells out with node `execSync/exec` + hand-rolled quoting/timeout; migrating to `pi.exec` would inherit cancellation from `ctx.signal`.)

## Current pi-sema usage (src/)

- `src/index.ts`: default factory; `session_start` → `ctx.ui.notify` (missing binary) / `ctx.ui.setStatus("sema", "sema <ver>")`; static `pi.registerTool` ×4 (`sema_eval/fmt/build/compile`, TypeBox params in `src/tools/*.ts`, no `onUpdate`, no custom renderers, no promptSnippet); `pi.registerCommand` ×3 (`sema-run/fmt/build`).
- `src/hooks/context.ts`: `before_agent_start` returns `{systemPrompt: event.systemPrompt + header + SEMA_KNOWLEDGE}` gated on `hasSemaFiles()`.
- `src/hooks/resources.ts`: `resources_discover` returns empty `skillPaths/promptPaths/themePaths` — placeholder, no skills shipped yet.
- Unused SDK headroom: onUpdate streaming, renderCall/renderResult, setWidget live panel, appendEntry, pi.exec, setActiveTools, registerShortcut, message renderers.

## Direct answers

1. Persistent live TUI panel: **yes** — `setWidget(key, factory)` above/below editor, `setFooter/setHeader`, or non-capturing overlay via `ui.custom({overlay:true})` + `OverlayHandle`; update via `tui.requestRender()` on a diff-rendering line-based Component model (`render(width): string[]`).
2. `registerTool` mid-session: **yes** (auto-activates + rebuilds system prompt); **no unregister**, but `setActiveTools` toggles per-turn; `ToolInfo/getAllTools` for introspection.
3. Streaming: `execute(toolCallId, params, signal, onUpdate, ctx)`; `onUpdate(AgentToolResult)` → `tool_execution_update` + `renderResult(..., {isPartial:true})` live inline rendering; `renderShell:"self"` for full custom framing.
4. MCP: **no built-in support** (explicitly out of scope per docs/usage.md:306); bridge via extension-side MCP client + dynamic `registerTool`.
5. Skills → `~/.pi/agent/skills` + `<cwd>/.pi/skills` (SKILL.md, agentskills.io XML in prompt); prompts → `.../prompts` markdown templates with `$1/$@` substitution; `resources_discover` adds paths; `before_agent_start` rewrites system prompt; `tool_call` blocks/patches; `appendEntry` persists non-LLM state; flags/shortcuts/keybindings as above.
6. `pi.exec` gives managed exec with `AbortSignal` + timeout, result `{stdout, stderr, code, killed}`.
