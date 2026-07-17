KEY FACTS:
- deftool/defagent are special forms lowered to __vm-deftool/__vm-defagent delegates (crates/sema-eval/src/eval.rs:1649-1690) that call register_tool/register_agent, which env.set() the value into the interpreter's global env (crates/sema-eval/src/special_forms.rs:70-135)
- ToolDefinition { name, description, parameters: Value, handler: Value } and Agent { name, system, tools, max_turns, model } at crates/sema-core/src/value.rs:426-442; Sema-level introspection via tool?/tool/name/tool/description/tool/parameters and agent/* (crates/sema-llm/src/builtins.rs:4177-4220); NO Sema builtin enumerates env bindings — Rust-only Env::iter_bindings (value.rs:3131)
- MCP server is stdio JSON-RPC (crates/sema-mcp/src/server.rs), protocolVersion 2024-11-05, capabilities tools.listChanged=false (server.rs:165-176); methods: initialize, ping, tools/list, tools/call only
- list_mcp_tools (crates/sema-mcp/src/tools.rs:558) recomputes the list on EVERY tools/list: 9 default tools (run_file, compile, eval, docs, fmt, disasm, build, info, docs_search) + 8 notebook/* tools + all ToolDef bindings found by scanning global env; hidden by _-prefix, :mcp/expose #f, :private #t, or --include/--exclude
- EMPIRICALLY VERIFIED: driving `sema mcp` over stdio, a deftool defined via the eval tool appears in the next tools/list with a correct JSON schema and is callable (dyn-add {a:2,b:40} -> 42) — dynamic in practice, but no list_changed notification is ever sent
- Existing mechanisms to expose a .sema file's deftools over MCP: (a) `sema mcp file.sema` filepath mode (main.rs:926-950), (b) `sema build file.sema -o bin` then `./bin --mcp` (main.rs:1993-2041), (c) runtime injection via the shared-env eval/run_file tools; no in-language (mcp/serve) builtin exists
- sema mcp hardcodes Sandbox::allow_all() (crates/sema/src/main.rs:921) — the MCP eval tool runs unsandboxed; info tool self-reports 'Sandbox: unrestricted'
- Sandbox model: Caps bitflags FS_READ/FS_WRITE/SHELL/NETWORK/ENV_READ/ENV_WRITE/PROCESS/LLM/SERIAL with STRICT and ALL presets (crates/sema-core/src/sandbox.rs); CLI --sandbox=strict|all|no-shell,... and --allowed-paths (canonicalized) per website/docs/cli.md:460-546
- `sema eval --expr/--stdin --json --sandbox --no-llm` returns a JSON envelope {ok,value,stdout,stderr,error_msg,error_hint,error_line,error_col,elapsed_ms}; its --timeout flag is parsed but IGNORED (bound as `timeout: _timeout` at main.rs:977; run_eval main.rs:1625-1631 doesn't take it) despite docs claiming a 5000ms default kill (cli.md:60)
- Budget controls: llm/set-budget, llm/budget-remaining, llm/with-budget {:max-cost-usd :max-tokens [:on-stream :pre-gate]} — scoped/nested, first-limit-hit errors (website/docs/llm/cost.md:77-110; sema-llm/src/builtins.rs:47-56)
- Persistence: SEMA_HOME > ~/.sema (sema-core/src/home.rs:5-13); packages in ~/.sema/packages (resolve.rs:6-8); entrypoint resolution <spec>.sema -> sema.toml entrypoint -> package.sema (resolve.rs:162-205); sema pkg init/add/install --locked/update/publish/search/yank/login against live registry pkg.sema-lang.com (website/docs/packages.md)
- MCP param schema mapping: sema_value_to_json_schema (tools.rs:21-98) supports :type/:description/:enum/:optional, strips mcp/* metadata keys; json_args_to_sema (tools.rs:322) maps named JSON args to positional handler slots by closure param names with type coercion and variadic rest support
- MCP client builtins mcp/connect|tools|call|tools->sema|close (sema-mcp/src/builtins.rs:1562-1610); mcp/tools->sema yields deftool-shaped values usable directly in defagent :tools; OAuth 2.1 auto-flow + sema mcp login/logout; MCP calls record/replay via the same cassette tape as LLM calls (website/docs/mcp.md)
- Client registration docs for Claude Code/Codex/Copilot/Gemini/Cursor/VS Code/Zed/OpenCode/etc in website/docs/mcp.md; MCPB bundle for Claude Desktop in mcpb/manifest.json (binary server, args ["mcp"])

# Sema tool/agent definitions & MCP server — research report

Repo: `/Users/helge/code/sema/sema` (Rust monorepo, workspace crates under `crates/`). Sema version verified live: 1.30.0 (`sema --version`, and `mcp__sema__info` → "Sema MCP Server v1.30.0").

## 1. `deftool` / `defagent` semantics

### Syntax & runtime representation
- `deftool` syntax: `(deftool name "description" parameters-map handler-expr)` — canonical doc at `crates/sema-docs/entries/special-forms/deftool.md`. `name` = symbol; description = string (LLM-facing); parameters-map = JSON-Schema-like Sema map (`{:a {:type :number :description "…" :optional #t :enum […]}}`); handler-expr evaluates to a function receiving the args **positionally**.
- Both are special forms (listed in `SPECIAL_FORM_NAMES`, `crates/sema-eval/src/special_forms.rs:57-58`). The VM lowers them and calls runtime delegates `__vm-deftool` / `__vm-defagent` (`crates/sema-eval/src/eval.rs:1649-1690`), which pass pre-evaluated description/parameters/handler to `register_tool` / `register_agent` (`crates/sema-eval/src/special_forms.rs:70-135`).
- Runtime value types (in `crates/sema-core/src/value.rs`):
  - `ToolDefinition { name: String, description: String, parameters: Value, handler: Value }` (value.rs:426-431); NaN-boxed as `ValueView::ToolDef(Rc<ToolDefinition>)`; prints as `<tool name>`.
  - `Agent { name: String, system: String, tools: Vec<Value>, max_turns: usize, model: String }` (value.rs:435-442). `defagent` opts map keys: `:system`, `:tools` (list or vector), `:max-turns` (default 10), `:model` (special_forms.rs:93-135).
- **Where definitions live:** `register_tool`/`register_agent` do `env.set(intern(name), value)` — the tool/agent is just an ordinary binding in the environment (the VM delegates capture the interpreter's **global env** weakly and bind there). The form also returns the value.
- **Anonymous constructors:** `(agent {:system … :tools […] …})` builds an unnamed agent inline (`crates/sema-llm/src/builtins.rs:4223-4235`); MCP client tools become ToolDef-shaped values via `mcp/tools->sema`.

### Introspection
- From Sema code: `tool?`, `tool/name`, `tool/description`, `tool/parameters` and `agent/name`, `agent/system`, `agent/tools`, `agent/model` (`crates/sema-llm/src/builtins.rs:4177-4220`; docs `website/docs/llm/tools-agents.md`). Verified live: `(tool/parameters scratch-hello)` returns the schema map.
- **"List all tools in an environment" exists only in Rust**, via `Env::iter_bindings` (`crates/sema-core/src/value.rs:3131`) — this is exactly what the MCP server's `list_mcp_tools` uses to discover user ToolDefs (`crates/sema-mcp/src/tools.rs:729` area). There is **no Sema-level builtin** to enumerate env bindings (docs_search for env introspection returns nothing relevant; only REPL/notebook/LSP use `iter_bindings` from Rust). So "list all deftools" from inside a script would need a new builtin — trivially implementable on `iter_bindings` filtering `ValueViewRef::ToolDef`.

### Param schemas
- Schema translation Sema→JSON-Schema: `sema_value_to_json_schema` (`crates/sema-mcp/src/tools.rs:21-98`): each param map may carry `:type`, `:description`, `:enum`, `:optional #t` (optional ⇒ not in `required`); a bare (non-map) param value = required string. Metadata keys `mcp/expose`, `private`, and anything `mcp/*`-prefixed are stripped from the schema.
- JSON args → positional Sema args: `json_args_to_sema` (`tools.rs:322+`) maps named JSON args into the handler closure's positional slots by parameter name (`handler_shape`), validates/coerces declared types (`coerce_typed`), distinguishes absent vs explicit-null, supports variadic rest params (JSON array spread flat). Errors are clear per-field strings.
- For LLM calls, `build_tool_schemas` (`crates/sema-llm/src/builtins.rs:7791`) converts ToolDefs into provider `ToolSchema`s; `agent/run` runs the bounded tool loop (max-turns, aborts after 5 consecutive tool errors; tool errors are fed back to the model, not fatal — `website/docs/llm/tools-agents.md`).

## 2. The Sema MCP server (`sema mcp`, crate `sema-mcp`)

### Startup & transport
- `sema mcp [FILES…] [--include a,b] [--exclude c]` (clap `Commands::Mcp`, `crates/sema/src/main.rs:321-334`). **stdio only**, line-delimited JSON-RPC 2.0 (`crates/sema-mcp/src/server.rs:9-126`, `run_mcp_server` reads stdin/writes stdout; program output is captured via thread-local stdout/stderr hooks so it can't corrupt the protocol stream — `tools.rs eval_with_capture`, ~line 470).
- The subcommand builds the interpreter with `sema_core::Sandbox::allow_all()` **hardcoded** (`main.rs:921-922`) — the global `--sandbox` flag is NOT applied in MCP-server mode. The `info` tool self-reports: "Sandbox: unrestricted — tools execute with full filesystem, network, and shell access" (verified live).
- It runs `(llm/auto-configure)` at startup, then `eval_str_compiled`s each FILE argument ("filepath mode"), then enters the stdio loop (`main.rs:926-950`).
- Protocol handling (`server.rs:148-224`): `initialize` (reports `protocolVersion "2024-11-05"`, capabilities `{"tools": {"listChanged": false}}`), `ping`, `tools/list`, `tools/call`; notifications ignored; everything else -32601.
- **Distribution to agents:** `website/docs/mcp.md` has copy-paste registration for Claude Code (`claude mcp add sema -- sema mcp`), Codex, Copilot CLI, Gemini CLI, Amp, Glue, Cursor, VS Code, Zed, OpenCode, Pi, Hermes, Claude Desktop. `mcpb/manifest.json` is an MCPB bundle (binary server, `args: ["mcp"]`, per-platform binaries) for Claude Desktop.

### Exposed tools (3 layers, `list_mcp_tools`, `crates/sema-mcp/src/tools.rs:558-760`)
1. **Default dev tools** (static): `run_file`, `compile`, `eval` (evaluate expression, capture stdout/stderr), `docs`, `fmt`, `disasm`, `build` (standalone executable), `info`, `docs_search`.
2. **Notebook tools** (static, stateful in-memory engine cache keyed by canonical path): `notebook/new|read|add_cell|update_cell|delete_cell|eval_cell|eval_all|export`.
3. **User `deftool`s**: on **every** `tools/list` call the server scans the shared interpreter's global env with `iter_bindings` for `ToolDef` values and exposes each as an MCP tool (name/description/schema via `sema_value_to_json_schema`). Hidden if: name starts with `_`, params contain `:mcp/expose #f` or `:private #t`, or filtered by `--include`/`--exclude` (`is_tool_allowed`, tools.rs:764-779).

### STATIC or DYNAMIC?
- The capability handshake says `listChanged: false` — the server **never emits `notifications/tools/list_changed`**.
- BUT the tool list is **recomputed from the live environment on every `tools/list`**, and all tools (`eval`, `run_file`, user tools) share ONE interpreter/global env. **Empirically verified** (drove `sema mcp` over stdio): calling `eval` with a `deftool` form made the new tool appear in the next `tools/list` (with correct schema `{a: int, b: int, required [a,b]}`) and it was immediately callable (`dyn-add {a:2,b:40}` → `42`). So the list is *de facto* dynamic; the only gap is that clients that cache the list after `listChanged:false` won't re-fetch. Making it truly push-dynamic = flip the capability to `true` + send the notification after an eval that binds a ToolDef (small change in `server.rs`; the write half is available in the loop).
- `run_file` also evaluates into the same shared env (a `SysArgsGuard` restores `sys/args` afterwards, tools.rs:781-800), so running a script file at runtime also registers its deftools.

### Serving a .sema file's tools — existing mechanisms
Three shipped paths (docs `website/docs/mcp.md`):
1. **Filepath mode:** `sema mcp tools/receipts.sema` — evaluates the file(s), exposes every non-private `deftool`.
2. **Standalone binary mode:** `sema build tools/receipts.sema -o receipt-extractor`; the built executable run with `--mcp` (plus `--include/--exclude`) evaluates its embedded bytecode then starts the same stdio MCP server (`main.rs:1993-2041`).
3. **Runtime injection via `eval`/`run_file`** (verified above).
There is no in-language `(mcp/serve …)` builtin — server startup is CLI-only; the `mcp/*` builtins are client-side only.

### Sema as MCP *client* (relevant for composition)
`mcp/connect` (stdio `:command`/`:args`/`:env`/`:cwd`, or HTTP `:url` with Streamable-HTTP + SSE fallback + automatic OAuth 2.1/PKCE/device-code, keychain or 0600-file token store, `sema mcp login/logout`), `mcp/tools`, `mcp/call`, `mcp/tools->sema` (produces deftool-shaped values usable in `defagent :tools`), `mcp/close` (`crates/sema-mcp/src/builtins.rs:1562-1610`; docs mcp.md §client). MCP `tools/call` results record/replay through the same **cassette** tape as LLM calls (deterministic CI replays; `llm/cassette-load {:mode :record|:replay}`, or env `SEMA_LLM_CASSETTE`/`SEMA_LLM_CASSETTE_MODE`).

## 3. Persistence / user library / module system

- **Sema home:** `$SEMA_HOME` > `~/.sema` (`crates/sema-core/src/home.rs:5-13`). Packages install to `~/.sema/packages/` (`crates/sema-core/src/resolve.rs:6-8`).
- **Module system:** `module`/`export`/`import`/`load` special forms. `import` resolves: relative/absolute `.sema` paths; registry short names; git-path specs (`github.com/user/repo[@ref][/submodule]`). Package entrypoint resolution order (`resolve.rs:162-205`): `~/.sema/packages/<spec>.sema` (direct sub-module file) → `sema.toml` `entrypoint` → `package.sema`. `is_package_import` (`resolve.rs:19-37`) treats first-segment-with-a-dot as git host, otherwise checks `~/.sema/packages/<name>` existence.
- **`sema pkg`** (docs `website/docs/packages.md`, impl `crates/sema/src/pkg.rs`): `init` (creates `sema.toml` + `package.sema`), `add name[@ver]` / `add github.com/u/r[@ref]`, `install [--locked]` (with `sema.lock` integrity: commit SHA for git, SHA256 for registry; orphan pruning), `update`, `publish`, `search`, `info`, `yank`, `login`. Central registry live at `pkg.sema-lang.com` (default); `--registry` override / self-hosted supported. Package = dir with `package.sema` and/or `sema.toml` (`[package] name/version/description/entrypoint`, `[deps]`).
- So a "user library of generated tools" fits naturally as: write `.sema` files into a package dir (or any dir), `sema mcp <files>` them, or `import` them; publishable/pinnable via `sema pkg`. There's no built-in snippet store beyond this.

## 4. Safety / sandboxing for eval

- **Capability sandbox** (`crates/sema-core/src/sandbox.rs`): `Caps` bitflags — `FS_READ, FS_WRITE, SHELL, NETWORK, ENV_READ, ENV_WRITE, PROCESS, LLM, SERIAL`; presets `ALL` (deny everything dangerous) and `STRICT` (deny shell, fs-write, network, env-write, process, **llm**, serial — reads allowed). `Sandbox { denied: Caps, allowed_paths: Option<Vec<PathBuf>> }`. Gated stdlib fns return `PermissionDenied` errors when denied (functions stay callable). `--allowed-paths` canonicalizes and confines all file ops independently of `--sandbox` (docs `website/docs/cli.md:460-546`).
- **CLI surfaces:**
  - `sema --sandbox=strict|all|no-shell,no-network,… --allowed-paths=./data script.sema` (script/REPL runs).
  - **`sema eval`** — the purpose-built safe-eval batch tool: `--expr`/`--stdin`, `--json` (envelope: `ok, value, stdout, stderr, error_msg, error_hint, error_line, error_col, elapsed_ms`), `--path`, `--sandbox`, `--no-llm`, `--timeout <ms>` (`main.rs:365-392`). **Gotcha:** `--timeout` is parsed but currently **ignored** — dispatch binds it as `timeout: _timeout` and `run_eval` doesn't take it (`main.rs:972-982`, `run_eval` signature `main.rs:1625-1631`); docs claim "Kill evaluation after N ms (default 5000)" (`cli.md:60`). An external process timeout is needed for now.
  - The MCP server (`sema mcp` and built-binary `--mcp`) is **always `Sandbox::allow_all()`** — no sandbox flag path exists there (`main.rs:921`, `main.rs:1987`). The MCP `eval` tool therefore runs unsandboxed; for a safe generate→eval→verify loop, shell out to `sema eval --json --sandbox strict --no-llm` (plus your own wall-clock kill) rather than the MCP `eval` tool, or run a separate `sema mcp` under an OS-level jail.
  - Workflows can *declare* caps: a workflow's declared denials are unioned into the effective sandbox (`main.rs:1267-1280`, `with_more_denied`).
- **LLM spend controls** (docs `website/docs/llm/cost.md`; impl `crates/sema-llm/src/builtins.rs` around lines 47-56): `llm/set-budget <usd>` (session limit, exceeding calls fail), `llm/budget-remaining` → `{:limit :spent :remaining}`, `llm/with-budget {:max-cost-usd X :max-tokens N [:on-stream :pre-gate]} thunk` — scoped, nestable (saved outer frames), whichever limit hits first errors; concurrent tasks inside one scope charge one shared budget; cache hits charge zero (accounting invariant in AGENTS.md). Unknown-model pricing ⇒ best-effort with one-time warning; `llm/set-pricing` to pin.
- **Deterministic verification:** FakeProvider (`sema_llm::fake`) for keyless scripted agent tests; cassettes for record/replay of both LLM and MCP calls — both useful as the "verify" stage of a generate→eval→verify→store loop without live spend.

## 5. Connecting to coding agents — summary of docs
- `website/docs/mcp.md` — full client-registration matrix (see §2), filepath mode, standalone-binary `--mcp` mode, tool filtering/visibility, notebook state, MCP-client side, OAuth, cassettes, security notes ("stdio connection spawns a process (`process` cap); HTTP is `network` cap; a server's tools run with the server's authority; treat tool output as untrusted").
- `website/docs/for-agents.md` — terse "Sema for LLM agents" language brief; `/llms.txt` index exists on the website (explicitly says don't load `llms-full.txt` ~200k tokens).
- MCPB bundle at `mcpb/` for Claude Desktop one-click install.

## Implications for a generate→eval→verify→store loop
- **Generate:** LLM writes a `.sema` file containing `deftool`s (schema conventions per §1; keep helpers `_`-prefixed or `:mcp/expose #f`).
- **Eval/verify safely:** `sema eval --stdin --json --sandbox strict --no-llm` (external timeout required — the flag is a no-op); or full-file `sema --sandbox=strict --allowed-paths=…` run; assert on the JSON envelope. Direct handler unit-tests: `(tool? x)` + call the handler via normal application; agent-level verification via FakeProvider/cassettes.
- **Store:** write to `~/.sema/…` or a package dir; `sema pkg init/publish` for durable/reusable; `import` for reuse.
- **Expose:** `sema mcp <stored-files>` (restart to pick up new files), or keep one long-lived `sema mcp` and inject via its `eval`/`run_file` tools (works today; client must re-list since `listChanged:false`), or `sema build … && ./tool --mcp` for a frozen artifact. True push-notification dynamism would require flipping `listChanged` to `true` and emitting the notification in `server.rs` (single-file change).