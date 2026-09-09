/**
 * The forge subsystem — the agent (or /sema:forge) authors persistent tools.
 *
 * WHAT: registers `create_sema_tool`, which turns a `(deftool …)` source into a
 * stored, live-registered pi tool. Companions: probe.ts (sandboxed verify),
 * prompts.ts (model-facing guidance).
 *
 * HOW/WHY: the pipeline is generate → verify → approve → store → inject →
 * register. Verification alone runs under `--sandbox strict --no-llm` to catch
 * bad source safely; real execution is unsandboxed, so the human approval
 * dialog is the gate. On success the deftool is eval'd into the live server and
 * the bridge re-syncs, making it callable on the very next turn.
 */
import { Type } from "typebox";
import { existsSync } from "node:fs";
import type {
  ExtensionAPI,
  AgentToolResult,
} from "@earendil-works/pi-coding-agent";
import type { PiSemaRuntime } from "../index.js";
import { sanitizeName } from "../library/store.js";
import type { TierName } from "../paths.js";
import { contentToText } from "../bridge/jsonrpc.js";
import { toolText, toolError } from "../tool-result.js";
import { extractSingleFormName } from "../util.js";
import { verifyToolSource, describeProbeFailure } from "./probe.js";
import { CREATE_TOOL_DESCRIPTION, CREATE_TOOL_GUIDELINES } from "./prompts.js";

const params = Type.Object({
  name: Type.String({
    description:
      "Tool name, kebab-case (e.g. pdf-extract). Namespacing with '/' is allowed.",
  }),
  description: Type.String({
    description: "One-line description of what the tool does",
  }),
  source: Type.String({
    description:
      "Complete Sema source: optional helper defines + exactly one (deftool …) form",
  }),
  tier: Type.Optional(
    Type.Union([Type.Literal("project"), Type.Literal("global")], {
      description:
        "Where to store it: project (.pi/pi-sema, travels with the repo) or global (~/.pi/agent/pi-sema). Omit to use the configured default.",
    }),
  ),
});

type Details = { stage?: string; isError?: boolean };

export function registerForgeTool(
  pi: ExtensionAPI,
  getRuntime: () => PiSemaRuntime | null,
): void {
  // Refinement rounds per tool name, reset on success. Keyed per session-runtime.
  const rounds = new Map<string, number>();

  pi.registerTool({
    name: "create_sema_tool",
    label: "Forge Sema tool",
    description: CREATE_TOOL_DESCRIPTION,
    promptSnippet:
      "Forge a persistent Sema tool from source (verified, user-approved, callable next turn)",
    promptGuidelines: CREATE_TOOL_GUIDELINES,
    parameters: params,
    async execute(
      _toolCallId,
      p,
      signal,
      onUpdate,
      ctx,
    ): Promise<AgentToolResult<Details>> {
      const runtime = getRuntime();
      if (!runtime) {
        return toolError("pi-sema is not initialized (sema binary missing?)");
      }
      const { cfg, store, bridge } = runtime;

      let name: string;
      try {
        name = sanitizeName(p.name);
      } catch (err) {
        return toolError(String(err instanceof Error ? err.message : err));
      }
      const deftoolName = extractDeftoolName(p.source);
      if (!deftoolName) {
        return toolError(
          'source must contain exactly one (deftool <name> "description" {params} (lambda …)) form',
        );
      }
      if (deftoolName !== name.split("/").pop() && deftoolName !== name) {
        return toolError(
          `declared name "${name}" does not match the deftool form's name "${deftoolName}" — make them agree`,
        );
      }
      if (!ctx.hasUI) {
        return toolError(
          "create_sema_tool requires the Pi TUI so the user can review and approve the source before it is stored or run.",
        );
      }

      // 1. Verify in the strict sandbox (the ONLY place --no-llm is used).
      onUpdate?.({
        content: [{ type: "text", text: "verifying in strict sandbox…" }],
        details: { stage: "probe" },
      });
      const probe = await verifyToolSource(p.source, deftoolName, {
        timeoutMs: cfg.forge.probeTimeoutMs,
        cwd: ctx.cwd,
        signal,
      });
      if (!probe.ok) {
        const round = (rounds.get(name) ?? 0) + 1;
        rounds.set(name, round);
        if (round >= cfg.forge.maxRounds) {
          rounds.delete(name);
          return toolError(
            `status: gave_up after ${round} rounds.\nLast error:\n${describeProbeFailure(probe)}\nStop retrying and tell the user what failed; ask how they'd like to proceed.`,
          );
        }
        return toolError(
          `status: probe_failed (round ${round}/${cfg.forge.maxRounds})\n${describeProbeFailure(probe)}\nFix the source and call create_sema_tool again.`,
        );
      }

      // 2. The single human gate: show the source before anything persists.
      const approved = await ctx.ui.confirm(
        `Create Sema tool "${name}"?`,
        `${p.description}\n\n${p.source.trim()}\n\nVerified in strict sandbox. It will run UNSANDBOXED when called (sandbox: ${cfg.sandbox.mcp}).`,
      );
      if (!approved) {
        rounds.delete(name);
        return toolError(
          "status: declined — the user rejected this tool. Do not resubmit unchanged; ask them what to change.",
        );
      }

      // 3. Store to the chosen tier — ask when the model didn't specify one.
      let tier: TierName = p.tier ?? cfg.library.defaultTier;
      if (!p.tier && ctx.hasUI) {
        const choice = await ctx.ui.select(`Where should "${name}" live?`, [
          `project (.pi/pi-sema — travels with this repo)${cfg.library.defaultTier === "project" ? " [default]" : ""}`,
          `global (~/.pi/agent/pi-sema — available everywhere)${cfg.library.defaultTier === "global" ? " [default]" : ""}`,
        ]);
        if (choice?.startsWith("global")) tier = "global";
        else if (choice?.startsWith("project")) tier = "project";
      }
      const targetPath = store.resolve("tools", name)?.path;
      const existed = targetPath != null && existsSync(targetPath);
      const path = store.save(
        tier,
        "tools",
        name,
        `${commentDescription(p.description)}\n${p.source.trim()}`,
      );

      // 4. Inject into the live server env + 5. register with pi.
      onUpdate?.({
        content: [{ type: "text", text: "injecting into live environment…" }],
        details: { stage: "inject" },
      });
      if (!bridge.running) {
        return toolError(
          `stored to ${path}, but the MCP bridge is not running. It will load when the bridge starts; no pi tool was registered.`,
        );
      }
      const injected = await bridge.injectSource(p.source);
      if (injected.isError) {
        const text = contentToText(injected.content);
        return toolError(
          `stored to ${path}, but live injection failed: ${text}\nIt will load on next session start.`,
        );
      }
      await bridge.refresh();
      const piName = bridge.piNameFor(deftoolName);
      if (!piName) {
        return toolError(
          `stored to ${path}, but it was not exposed as a pi tool. Check excludeTools and the deftool visibility settings before retrying.`,
        );
      }

      // 6. Record in the session log.
      pi.appendEntry("sema:forge", { name, tier, path, piName });
      rounds.delete(name);

      return toolText(
        `status: ${existed ? "updated (overwrote existing definition; live env re-injected)" : "created"}\n` +
          `Stored: ${path} (${tier} tier)\n` +
          `Registered as pi tool: ${piName} — callable directly from your NEXT turn.\n` +
          `To exercise it THIS turn, call sema_eval with (tool/invoke ${deftoolName} {:param value}) — the definition is already live.`,
      );
    },
  });
}

/** Extract the tool name from the (single) deftool form; null when absent/ambiguous. */
export function extractDeftoolName(source: string): string | null {
  return extractSingleFormName(source, "deftool");
}

function commentDescription(description: string): string {
  return description
    .trim()
    .split(/\r\n?|\n/)
    .map((line) => `; ${line}`)
    .join("\n");
}
