/**
 * pi-sema extension entrypoint.
 *
 * WHAT: the default export is the extension factory pi calls once at load. It
 * registers config flags, tools, commands, hooks, and the dashboard, and owns
 * the per-session `runtime` (config + library store + MCP bridge).
 *
 * HOW/WHY: `runtime` is (re)built on every `session_start` rather than at load
 * time so a new cwd or edited config is always honored; everything downstream
 * reaches it through the `getRuntime()` closure instead of a module global, so
 * there is no stale state to reset between sessions.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isSemaInstalled, semaVersion, spawnSema } from "./sema.js";
import {
  loadConfig,
  registerConfigFlags,
  type PiSemaConfig,
} from "./config.js";
import { LibraryStore } from "./library/store.js";
import { SemaBridge } from "./bridge/bridge.js";
import { registerContextHooks } from "./hooks/context.js";
import { registerCommands } from "./commands.js";
import { registerForgeTool } from "./forge/forge.js";
import { registerWorkflowRunTool } from "./workflows/runner.js";
import { registerWorkflowAuthoring } from "./workflows/author.js";
import { registerDashboard } from "./ui/dashboard.js";
import { registerToolResultErrorHook } from "./tool-result.js";

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
    // Probe sandbox support up front so it overlaps the install/version checks.
    const sandboxSupported = mcpSandboxSupported();
    if (!(await isSemaInstalled())) {
      void sandboxSupported.catch(() => {});
      ctx.ui.notify(
        "sema binary not found on PATH. Install: curl -fsSL https://sema-lang.com/install.sh | sh",
        "warning",
      );
      return;
    }
    ctx.ui.setStatus("sema", (await semaVersion()) ?? "sema");

    const cfg = loadConfig(ctx.cwd, pi, (msg) => ctx.ui.notify(msg, "warning"));
    const store = new LibraryStore(ctx.cwd);
    const bridge = new SemaBridge(pi, cfg, store, (msg, type) =>
      ctx.ui.notify(msg, type),
    );
    bridge.registerStatusTool();
    runtime = { cfg, store, bridge };

    try {
      await bridge.start(ctx.cwd, await sandboxSupported);
    } catch (err) {
      ctx.ui.notify(
        `pi-sema: MCP bridge failed to start: ${err instanceof Error ? err.message : err}`,
        "error",
      );
    }
  });

  pi.on("session_shutdown", async () => {
    await runtime?.bridge.stop();
    runtime = null;
  });

  registerCommands(pi, getRuntime);
  registerForgeTool(pi, getRuntime);
  registerWorkflowRunTool(pi, getRuntime);
  registerWorkflowAuthoring(pi, getRuntime);
  registerDashboard(pi, getRuntime);
  registerContextHooks(pi);
  registerToolResultErrorHook(pi);
}

let sandboxSupportCache: boolean | undefined;

/** Feature-detect the upstream `sema mcp --sandbox` patch. */
async function mcpSandboxSupported(): Promise<boolean> {
  if (sandboxSupportCache !== undefined) return sandboxSupportCache;
  const help = await spawnSema(["mcp", "--help"], { timeoutMs: 5000 });
  sandboxSupportCache = help.code === 0 && help.stdout.includes("--sandbox");
  return sandboxSupportCache;
}
