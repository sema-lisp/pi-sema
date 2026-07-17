import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { runSema } from "../sema.js";

export const fmtCommand = {
  description: "Format a Sema (.sema) file using sema fmt",
  usage: "/sema-fmt <path-to-file>",
  handler: async (args: string, ctx: ExtensionCommandContext) => {
    const path = args.trim();
    if (!path) {
      ctx.ui.notify("Usage: /sema-fmt <file>", "error");
      return;
    }

    ctx.ui.setStatus("sema-fmt", `Formatting ${path}...`);
    const result = runSema(["fmt", path]);
    ctx.ui.setStatus("sema-fmt", "");

    if (result.exitCode === 0) {
      ctx.ui.notify(`✓ Formatted ${path}`, "info");
    } else {
      ctx.ui.notify(`✗ Format failed: ${result.stderr || "unknown error"}`, "error");
    }
  },
};
