import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { PiSemaConfig } from "../config.js";
import type { LibraryStore } from "../library/store.js";
import { McpProcess } from "./process.js";
import { mcpListTools, mcpCallTool, type McpCallResult, type McpTool } from "./jsonrpc.js";
import { sanitizeSchema, toPiToolName, expandExcludes } from "./schema.js";
import { spawnSema } from "../sema.js";

const CALL_TIMEOUT_MS = 120_000;

/** Per-tool prompt hints for the noisier default tools. */
const PROMPT_SNIPPETS: Record<string, string> = {
  eval: "Evaluate Sema code in the shared live environment (deftool definitions persist)",
  run_file: "Run a .sema file",
  docs_search: "Search the Sema language/stdlib documentation",
  fmt: "Format Sema source",
  check: "Statically check Sema source",
};

/**
 * Bridges the long-lived `sema mcp` server into pi: every MCP tool becomes a
 * native `sema_*` pi tool, and the live tools/list recompute (verified: the
 * list is rebuilt from the server env on every call) makes forged deftools
 * appear without any restart.
 */
export class SemaBridge {
  private process: McpProcess | null = null;
  /** mcpName → piName for everything we've registered. */
  private registered = new Map<string, string>();
  /** mcpName → hash of description+schema, to re-register on definition drift. */
  private signatures = new Map<string, string>();
  private excluded = new Set<string>();
  private cwd = process.cwd();

  constructor(
    private readonly pi: ExtensionAPI,
    private readonly cfg: PiSemaConfig,
    private readonly store: LibraryStore,
    private readonly notify: (msg: string, type?: "info" | "warning" | "error") => void,
  ) {}

  get running(): boolean {
    return this.process?.running ?? false;
  }

  /**
   * The bridge is a private child process — it deliberately does NOT appear in
   * MCP-listing tools (e.g. pi-mcp-adapter's `mcp`), which enumerate mcp.json
   * servers. This tool is the introspection surface instead; it needs no MCP
   * round-trip, so it answers even when the server is down.
   */
  registerStatusTool(): void {
    const bridge = this;
    this.pi.registerTool({
      name: "sema_status",
      label: "Sema: bridge status",
      description:
        "Health of the sema MCP bridge (a private child process — it does not appear in MCP server listings). Shows running state, pid, sandbox mode, and registered/excluded tool counts. Works even when the bridge is down.",
      parameters: sanitizeSchema({ type: "object", properties: {} }),
      async execute(): Promise<AgentToolResult<unknown>> {
        const proc = bridge.process;
        const lines = [
          `bridge: ${proc?.running ? "running" : "DOWN"}${proc?.pid ? ` (pid ${proc.pid})` : ""}${proc?.hasRestarted ? " — crashed and auto-restarted once" : ""}`,
          `sandbox (mcp): ${bridge.cfg.sandbox.mcp}`,
          `registered tools: ${bridge.registered.size} (${[...bridge.registered.values()].join(", ") || "none"})`,
          `excluded: ${[...bridge.excluded].join(", ") || "none"}`,
        ];
        return { content: [{ type: "text", text: lines.join("\n") }], details: {} };
      },
    });
  }

  async start(cwd: string, sandboxSupported: boolean): Promise<void> {
    this.cwd = cwd;
    const sandbox = this.cfg.sandbox.mcp;
    if (sandbox !== "all" && !sandboxSupported) {
      this.notify(
        `pi-sema: config wants mcp sandbox "${sandbox}" but this sema build has no \`sema mcp --sandbox\` — running unsandboxed (allow-all)`,
        "warning",
      );
    }
    this.process = new McpProcess({
      toolFiles: this.store.filePaths("tools"),
      cwd,
      sandbox: sandbox !== "all" && sandboxSupported ? sandbox : undefined,
      onCrash: (code) => this.notify(`pi-sema: sema mcp crashed repeatedly (exit ${code}) — bridge offline`, "error"),
    });
    await this.process.start();
    await this.refresh();
  }

  async stop(): Promise<void> {
    await this.process?.stop();
    this.process = null;
  }

  /**
   * tools/list → diff → register new tools. Always ends by re-asserting the
   * full active set: deactivated-then-re-registered names do NOT auto-reactivate.
   */
  async refresh(): Promise<string[]> {
    if (!this.process?.running) return [];
    const tools = await mcpListTools(this.process.client);

    this.excluded = new Set(expandExcludes(this.cfg.excludeTools, tools.map((t) => t.name)));

    const added: string[] = [];
    for (const tool of tools) {
      if (this.excluded.has(tool.name)) continue;
      const signature = JSON.stringify([tool.description, tool.inputSchema]);
      if (this.registered.has(tool.name)) {
        // Re-forged tool with a changed description/schema: re-register under
        // the SAME pi name (within-extension registration is last-wins) so the
        // model sees the fresh definition instead of a stale schema.
        if (this.signatures.get(tool.name) !== signature) {
          this.signatures.set(tool.name, signature);
          this.registerOne(tool, this.registered.get(tool.name));
        }
        continue;
      }
      this.signatures.set(tool.name, signature);
      this.registerOne(tool);
      added.push(this.registered.get(tool.name)!);
    }

    if (added.length > 0) {
      const active = new Set(this.pi.getActiveTools());
      for (const name of this.registered.values()) active.add(name);
      this.pi.setActiveTools([...active]);
    }
    return added;
  }

  /** Evaluate source in the live server env (used by forge to inject deftools). */
  async injectSource(source: string): Promise<McpCallResult> {
    if (!this.process?.running) throw new Error("sema mcp bridge is not running");
    return mcpCallTool(this.process.client, "eval", { code: source }, 60_000);
  }

  piNameFor(mcpName: string): string | undefined {
    return this.registered.get(mcpName);
  }

  private registerRunFile(tool: McpTool, piName: string): void {
    const bridge = this;
    this.pi.registerTool({
      name: piName,
      label: "Sema: run_file",
      description:
        tool.description ??
        "Run a .sema file in an isolated subprocess (survives bridge crashes; safe for LLM-heavy scripts).",
      parameters: runFileSchema(),
      promptSnippet: "Run a .sema file in an isolated subprocess",
      async execute(_id, params, signal): Promise<AgentToolResult<unknown>> {
        const p = params as { file_path: string; arguments?: string[] };
        // Sandbox parity with the bridge: the top-level --sandbox flag uses
        // the same grammar the mcp server would apply.
        const args: string[] = [];
        if (bridge.cfg.sandbox.mcp !== "all") args.push("--sandbox", bridge.cfg.sandbox.mcp);
        args.push(p.file_path);
        if (p.arguments && p.arguments.length > 0) args.push("--", ...p.arguments);
        const result = await spawnSema(args, { cwd: bridge.cwd, timeoutMs: RUN_FILE_TIMEOUT_MS, signal });
        const text = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n--- stderr ---\n");
        if (result.killed) {
          return { content: [{ type: "text", text: `${text}\n(killed: timeout or abort)` }], details: { isError: true } };
        }
        return {
          content: [{ type: "text", text: text || "(no output)" }],
          details: result.code === 0 ? {} : { isError: true, exitCode: result.code },
        };
      },
    });
  }

  private registerOne(tool: McpTool, existingPiName?: string): void {
    const taken = new Set(this.registered.values());
    const piName = existingPiName ?? toPiToolName(tool.name, taken);
    this.registered.set(tool.name, piName);

    // run_file gets a genuinely isolated subprocess instead of riding the
    // shared MCP stdio channel: a script that crashes (or floods stdout)
    // can't take the bridge down with it, and it works even when the bridge is.
    if (tool.name === "run_file") {
      this.registerRunFile(tool, piName);
      return;
    }

    const bridge = this;
    this.pi.registerTool({
      name: piName,
      label: `Sema: ${tool.name}`,
      description: tool.description ?? `Sema MCP tool ${tool.name}`,
      parameters: sanitizeSchema(tool.inputSchema),
      promptSnippet: PROMPT_SNIPPETS[tool.name],
      async execute(_toolCallId, params, signal): Promise<AgentToolResult<unknown>> {
        if (!bridge.process?.running) {
          return {
            content: [{ type: "text", text: "sema mcp bridge is not running (binary missing or crashed)" }],
            details: { isError: true },
          };
        }
        const call = mcpCallTool(bridge.process.client, tool.name, params, CALL_TIMEOUT_MS);
        const result = await raceAbort(call, signal);
        if (result === ABORTED) {
          return { content: [{ type: "text", text: "aborted" }], details: { isError: true } };
        }

        // Self-extension fast path: evals that define tools re-sync the registry
        // so the agent can call what it just defined on the next turn.
        if (tool.name === "eval" && typeof (params as any)?.code === "string" && /\(deftool\s/.test((params as any).code)) {
          bridge.refresh().catch(() => {});
        }

        const text = result.content
          .map((block) => (block.type === "text" ? (block.text ?? "") : `[${block.type}]`))
          .join("\n")
          .trim();
        return {
          content: [{ type: "text", text: text || "(no output)" }],
          details: result.isError ? { isError: true } : {},
        };
      },
    });
  }
}

const RUN_FILE_TIMEOUT_MS = 300_000;

function runFileSchema(): ReturnType<typeof sanitizeSchema> {
  return sanitizeSchema({
    type: "object",
    properties: {
      file_path: { type: "string", description: "Path to the .sema (or .semac) file to run" },
      arguments: { type: "array", items: { type: "string" }, description: "Script arguments (passed after --)" },
    },
    required: ["file_path"],
  });
}

const ABORTED = Symbol("aborted");

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T | typeof ABORTED> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.resolve(ABORTED);
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve(ABORTED);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}
