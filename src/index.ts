import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isSemaInstalled, semaVersion, spawnSema } from "./sema.js";
import { loadConfig, registerConfigFlags, type PiSemaConfig } from "./config.js";
import { LibraryStore } from "./library/store.js";
import { SemaBridge } from "./bridge/bridge.js";
import { registerContextHooks } from "./hooks/context.js";
import { registerResourceHooks } from "./hooks/resources.js";
import { registerCommands } from "./commands.js";
import { registerForgeTool } from "./forge/forge.js";
import { registerWorkflowRunTool } from "./workflows/runner.js";

export interface PiSemaRuntime {
  cfg: PiSemaConfig;
  store: LibraryStore;
  bridge: SemaBridge;
}

export default function (pi: ExtensionAPI) {
  registerConfigFlags(pi);

  // Session-scoped state, (re)built on session_start so cwd/config changes are honored.
  let runtime: PiSemaRuntime | null = null;
  const getRuntime = () => runtime;

  pi.on("session_start", async (_event, ctx) => {
    if (!(await isSemaInstalled())) {
      ctx.ui.notify(
        "sema binary not found on PATH. Install: curl -fsSL https://sema-lang.com/install.sh | sh",
        "warning",
      );
      return;
    }
    ctx.ui.setStatus("sema", (await semaVersion()) ?? "sema");

    const cfg = loadConfig(ctx.cwd, pi, (msg) => ctx.ui.notify(msg, "warning"));
    const store = new LibraryStore(ctx.cwd);
    const bridge = new SemaBridge(pi, cfg, store, (msg, type) => ctx.ui.notify(msg, type));
    runtime = { cfg, store, bridge };

    try {
      await bridge.start(ctx.cwd, await mcpSandboxSupported());
    } catch (err) {
      ctx.ui.notify(`pi-sema: MCP bridge failed to start: ${err instanceof Error ? err.message : err}`, "error");
    }
  });

  pi.on("session_shutdown", async () => {
    await runtime?.bridge.stop();
    runtime = null;
  });

  registerCommands(pi, getRuntime);
  registerForgeTool(pi, getRuntime);
  registerWorkflowRunTool(pi, getRuntime);
  registerContextHooks(pi);
  registerResourceHooks(pi);
}

let sandboxSupportCache: boolean | undefined;

/** Feature-detect the upstream `sema mcp --sandbox` patch. */
async function mcpSandboxSupported(): Promise<boolean> {
  if (sandboxSupportCache !== undefined) return sandboxSupportCache;
  const help = await spawnSema(["mcp", "--help"], { timeoutMs: 5000 });
  sandboxSupportCache = help.code === 0 && help.stdout.includes("--sandbox");
  return sandboxSupportCache;
}
