import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PiSemaRuntime } from "./index.js";
import { renderForgePrompt, renderWorkflowPrompt } from "./forge/prompts.js";

/**
 * All human-facing commands live under the `sema:` prefix (legal and
 * precedented — pi itself surfaces skills as `skill:<name>`).
 */
export function registerCommands(pi: ExtensionAPI, getRuntime: () => PiSemaRuntime | null): void {
  pi.registerCommand("sema:forge", {
    description: "Forge a new Sema tool from a natural-language description (generate → verify → approve → store)",
    handler: async (args, ctx) => {
      let description = args.trim();
      if (!description && ctx.hasUI) {
        description = (await ctx.ui.input("What should the tool do?", "e.g. parse a composer.lock and list outdated deps")) ?? "";
      }
      if (!description) {
        ctx.ui.notify("Usage: /sema:forge <what the tool should do>", "warning");
        return;
      }
      pi.sendMessage(
        { customType: "sema:forge-request", content: renderForgePrompt(description), display: true },
        { triggerTurn: true },
      );
    },
  });

  pi.registerCommand("sema:workflow", {
    description: "Author a Sema workflow from a natural-language description (generate → check → approve → store → run)",
    handler: async (args, ctx) => {
      let description = args.trim();
      if (!description && ctx.hasUI) {
        description =
          (await ctx.ui.input(
            "What should the workflow do?",
            "e.g. research topics from topics.txt, write articles, fact-check with 10 agents",
          )) ?? "";
      }
      if (!description) {
        ctx.ui.notify("Usage: /sema:workflow <what the workflow should do>", "warning");
        return;
      }
      pi.sendMessage(
        { customType: "sema:workflow-request", content: renderWorkflowPrompt(description), display: true },
        { triggerTurn: true },
      );
    },
  });

  pi.registerCommand("sema:tools", {
    description: "List Sema tools (bridged + forged); 'refresh' to re-sync from the MCP server",
    handler: async (args, ctx) => {
      const runtime = getRuntime();
      if (!runtime?.bridge.running) {
        ctx.ui.notify("sema MCP bridge is not running", "warning");
        return;
      }
      if (args.trim() === "refresh") {
        const added = await runtime.bridge.refresh();
        ctx.ui.notify(added.length > 0 ? `Registered: ${added.join(", ")}` : "No new tools", "info");
        return;
      }
      const stored = runtime.store.list("tools");
      const active = pi
        .getActiveTools()
        .filter((t) => t.startsWith("sema_"))
        .sort();
      const lines = [
        `Active sema tools (${active.length}): ${active.join(", ") || "none"}`,
        `Stored library tools (${stored.length}): ${stored.map((e) => `${e.name} [${e.tier}]`).join(", ") || "none"}`,
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
