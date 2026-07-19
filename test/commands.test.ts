import { describe, expect, it, vi } from "vitest";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { registerCommands } from "../src/commands.js";
import type { PiSemaRuntime } from "../src/index.js";

type CommandHandler = (
  args: string,
  ctx: ExtensionCommandContext,
) => Promise<void> | void;

function setup(options: {
  active?: string[];
  stored?: { name: string; tier: "global" | "project" }[];
  refreshed?: string[];
}) {
  let toolsHandler: CommandHandler | undefined;
  const pi = {
    registerCommand(name: string, definition: { handler: CommandHandler }) {
      if (name === "sema:tools") toolsHandler = definition.handler;
    },
    getActiveTools: () => options.active ?? [],
  } as unknown as ExtensionAPI;
  const refresh = vi.fn(async () => options.refreshed ?? []);
  const runtime = {
    bridge: { running: true, refresh },
    store: { list: () => options.stored ?? [] },
  } as unknown as PiSemaRuntime;
  const notify = vi.fn();
  const ctx = { ui: { notify } } as unknown as ExtensionCommandContext;

  registerCommands(pi, () => runtime);
  return { handler: toolsHandler!, ctx, notify, refresh };
}

describe("/sema:tools", () => {
  it("renders active and stored tools as separate bullet lists", async () => {
    const { handler, ctx, notify } = setup({
      active: ["read", "sema_eval", "sema_build"],
      stored: [
        { name: "lightning-square", tier: "global" },
        { name: "repo-annotations", tier: "project" },
      ],
    });

    await handler("", ctx);

    expect(notify).toHaveBeenCalledWith(
      [
        "Active sema tools (2)",
        "  • sema_build",
        "  • sema_eval",
        "",
        "Stored library tools (2)",
        "  • lightning-square [global]",
        "  • repo-annotations [project]",
      ].join("\n"),
      "info",
    );
  });

  it("shows an indented none row for empty groups", async () => {
    const { handler, ctx, notify } = setup({});

    await handler("", ctx);

    expect(notify).toHaveBeenCalledWith(
      [
        "Active sema tools (0)",
        "  none",
        "",
        "Stored library tools (0)",
        "  none",
      ].join("\n"),
      "info",
    );
  });

  it("preserves refresh behavior", async () => {
    const { handler, ctx, notify, refresh } = setup({
      refreshed: ["sema_new"],
    });

    await handler("refresh", ctx);

    expect(refresh).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith("Registered: sema_new", "info");
  });
});
