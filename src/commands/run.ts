import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { runSema } from "../sema.js";

export const runCommand = {
  description: "Run a Sema (.sema) file and display the output",
  usage: "/sema-run <path-to-file> [args...]",
  handler: async (args: string, ctx: ExtensionCommandContext) => {
    const parts = args.trim().split(/\s+/);
    if (parts.length === 0 || parts[0] === "") {
      ctx.ui.notify("Usage: /sema-run <file> [args...]", "error");
      return;
    }

    const [file, ...rest] = parts;
    ctx.ui.setStatus("sema-run", `Running ${file}...`);

    const result = runSema([file, ...rest], 60_000);
    ctx.ui.setStatus("sema-run", "");

    if (result.exitCode === 0) {
      ctx.ui.notify(`✓ ${file} finished`, "info");
    } else {
      ctx.ui.notify(`✗ ${file} failed (exit ${result.exitCode})`, "error");
    }
  },
};
