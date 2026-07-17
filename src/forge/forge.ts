import { Type } from "typebox";
import type { ExtensionAPI, AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { PiSemaRuntime } from "../index.js";
import { sanitizeName } from "../library/store.js";
import type { TierName } from "../paths.js";
import { verifyToolSource, describeProbeFailure } from "./probe.js";
import { CREATE_TOOL_DESCRIPTION, CREATE_TOOL_GUIDELINES } from "./prompts.js";

const params = Type.Object({
  name: Type.String({ description: "Tool name, kebab-case (e.g. pdf-extract). Namespacing with '/' is allowed." }),
  description: Type.String({ description: "One-line description of what the tool does" }),
  source: Type.String({ description: "Complete Sema source: optional helper defines + exactly one (deftool …) form" }),
  tier: Type.Optional(
    Type.Union([Type.Literal("project"), Type.Literal("global")], {
      description: "Where to store it: project (.pi/pi-sema, travels with the repo) or global (~/.pi/agent/pi-sema). Omit to use the configured default.",
    }),
  ),
});

type Details = { stage?: string; isError?: boolean };

export function registerForgeTool(pi: ExtensionAPI, getRuntime: () => PiSemaRuntime | null): void {
  // Refinement rounds per tool name, reset on success. Keyed per session-runtime.
  const rounds = new Map<string, number>();

  pi.registerTool({
    name: "create_sema_tool",
    label: "Forge Sema tool",
    description: CREATE_TOOL_DESCRIPTION,
    promptSnippet: "Forge a persistent Sema tool from source (verified, user-approved, callable next turn)",
    promptGuidelines: CREATE_TOOL_GUIDELINES,
    parameters: params,
    async execute(_toolCallId, p, signal, onUpdate, ctx): Promise<AgentToolResult<Details>> {
      const runtime = getRuntime();
      if (!runtime) {
        return fail("pi-sema is not initialized (sema binary missing?)");
      }
      const { cfg, store, bridge } = runtime;

      let name: string;
      try {
        name = sanitizeName(p.name);
      } catch (err) {
        return fail(String(err instanceof Error ? err.message : err));
      }
      const deftoolName = extractDeftoolName(p.source);
      if (!deftoolName) {
        return fail('source must contain exactly one (deftool <name> "description" {params} (lambda …)) form');
      }
      if (deftoolName !== name.split("/").pop() && deftoolName !== name) {
        return fail(
          `declared name "${name}" does not match the deftool form's name "${deftoolName}" — make them agree`,
        );
      }

      // 1. Verify in the strict sandbox (the ONLY place --no-llm is used).
      onUpdate?.({ content: [{ type: "text", text: "verifying in strict sandbox…" }], details: { stage: "probe" } });
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
          return fail(
            `status: gave_up after ${round} rounds.\nLast error:\n${describeProbeFailure(probe)}\nStop retrying and tell the user what failed; ask how they'd like to proceed.`,
          );
        }
        return fail(
          `status: probe_failed (round ${round}/${cfg.forge.maxRounds})\n${describeProbeFailure(probe)}\nFix the source and call create_sema_tool again.`,
        );
      }

      // 2. The single human gate: show the source before anything persists.
      if (ctx.hasUI) {
        const approved = await ctx.ui.confirm(
          `Create Sema tool "${name}"?`,
          `${p.description}\n\n${p.source.trim()}\n\nVerified in strict sandbox. It will run UNSANDBOXED when called (sandbox: ${cfg.sandbox.mcp}).`,
        );
        if (!approved) {
          rounds.delete(name);
          return fail("status: declined — the user rejected this tool. Do not resubmit unchanged; ask them what to change.");
        }
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
      const path = store.save(tier, "tools", name, `; ${p.description}\n${p.source.trim()}`);

      // 4. Inject into the live server env + 5. register with pi.
      onUpdate?.({ content: [{ type: "text", text: "injecting into live environment…" }], details: { stage: "inject" } });
      let piName = `sema_${deftoolName.replace(/[^a-zA-Z0-9_]/g, "_")}`;
      if (bridge.running) {
        const injected = await bridge.injectSource(p.source);
        if (injected.isError) {
          const text = injected.content.map((c) => c.text ?? "").join("\n");
          return fail(`stored to ${path}, but live injection failed: ${text}\nIt will load on next session start.`);
        }
        await bridge.refresh();
        piName = bridge.piNameFor(deftoolName) ?? piName;
      }

      // 6. Record in the session log.
      pi.appendEntry("sema:forge", { name, tier, path, piName });
      rounds.delete(name);

      return {
        content: [
          {
            type: "text",
            text: `status: created\nStored: ${path} (${tier} tier)\nRegistered as pi tool: ${piName} — callable from your NEXT turn.`,
          },
        ],
        details: {},
      };
    },
  });
}

function fail(text: string): AgentToolResult<Details> {
  return { content: [{ type: "text", text }], details: { isError: true } };
}

/** Extract the tool name from the (single) deftool form; null when absent/ambiguous. */
export function extractDeftoolName(source: string): string | null {
  const matches = [...source.matchAll(/\(deftool\s+([^\s()]+)/g)];
  if (matches.length !== 1) return null;
  return matches[0][1];
}
