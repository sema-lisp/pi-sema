import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { runSema } from "../sema.js";

export const buildCommand = {
  description: "Build a Sema program into a standalone executable",
  usage: "/sema-build <file> [output]",
  handler: async (args: string, ctx: ExtensionCommandContext) => {
    const parts = args.trim().split(/\s+/);
    if (parts.length === 0 || parts[0] === "") {
      ctx.ui.notify("Usage: /sema-build <file> [output]", "error");
      return;
    }

    const cmdArgs = ["build", parts[0]];
    if (parts.length > 1) {
      cmdArgs.push("-o", parts[1]);
    }

    ctx.ui.setStatus("sema-build", `Building ${parts[0]}...`);
    const result = runSema(cmdArgs, 120_000);
    ctx.ui.setStatus("sema-build", "");

    if (result.exitCode === 0) {
      const target = parts[1] || parts[0].replace(/\.sema$/, "");
      ctx.ui.notify(`✓ Built ${parts[0]} → ${target}`, "info");
    } else {
      ctx.ui.notify(`✗ Build failed: ${result.stderr || "unknown error"}`, "error");
    }
  },
};
