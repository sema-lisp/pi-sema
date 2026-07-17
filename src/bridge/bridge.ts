import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { PiSemaConfig } from "../config.js";
import type { LibraryStore } from "../library/store.js";
import { McpProcess } from "./process.js";
import { mcpListTools, mcpCallTool, type McpCallResult, type McpTool } from "./jsonrpc.js";
import { sanitizeSchema, toPiToolName, expandExcludes } from "./schema.js";

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
  private excluded = new Set<string>();

  constructor(
    private readonly pi: ExtensionAPI,
    private readonly cfg: PiSemaConfig,
    private readonly store: LibraryStore,
    private readonly notify: (msg: string, type?: "info" | "warning" | "error") => void,
  ) {}

  get running(): boolean {
    return this.process?.running ?? false;
  }

  async start(cwd: string, sandboxSupported: boolean): Promise<void> {
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
      if (this.excluded.has(tool.name) || this.registered.has(tool.name)) continue;
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

  private registerOne(tool: McpTool): void {
    const taken = new Set(this.registered.values());
    const piName = toPiToolName(tool.name, taken);
    this.registered.set(tool.name, piName);

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
