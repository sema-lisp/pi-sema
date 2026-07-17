import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { semaEvalParams, semaEvalExecute } from "./tools/eval.js";
import { semaFmtParams, semaFmtExecute } from "./tools/fmt.js";
import { semaBuildParams, semaBuildExecute } from "./tools/build.js";
import { semaCompileParams, semaCompileExecute } from "./tools/compile.js";
import { runCommand } from "./commands/run.js";
import { fmtCommand } from "./commands/fmt.js";
import { buildCommand } from "./commands/build.js";
import { registerContextHooks } from "./hooks/context.js";
import { registerResourceHooks } from "./hooks/resources.js";
import { isSemaInstalled, semaVersion } from "./sema.js";

export default function (pi: ExtensionAPI) {
  const installed = isSemaInstalled();
  const version = semaVersion();

  pi.on("session_start", async (_event, ctx) => {
    if (!installed) {
      ctx.ui.notify(
        "sema binary not found on PATH. Install: cargo install sema-lang or visit https://sema-lang.com",
        "warning",
      );
      return;
    }
    ctx.ui.setStatus("sema", `sema ${version || ""}`.trim());
  });

  if (!installed) return;

  pi.registerTool({
    name: "sema_eval",
    label: "Sema Eval",
    description: "Evaluate a Sema expression or run a .sema file. Pass either `code` for inline eval or `file` to run a script.",
    parameters: semaEvalParams,
    execute: semaEvalExecute,
  });

  pi.registerTool({
    name: "sema_fmt",
    label: "Sema Format",
    description: "Format a Sema (.sema) source file using sema fmt. Pass `check: true` to check without modifying.",
    parameters: semaFmtParams,
    execute: semaFmtExecute,
  });

  pi.registerTool({
    name: "sema_build",
    label: "Sema Build",
    description: "Build a Sema (.sema) program into a standalone executable using sema build.",
    parameters: semaBuildParams,
    execute: semaBuildExecute,
  });

  pi.registerTool({
    name: "sema_compile",
    label: "Sema Compile",
    description: "Compile a Sema (.sema) file to bytecode (.semac) using sema compile.",
    parameters: semaCompileParams,
    execute: semaCompileExecute,
  });

  pi.registerCommand("sema-run", runCommand);
  pi.registerCommand("sema-fmt", fmtCommand);
  pi.registerCommand("sema-build", buildCommand);

  registerContextHooks(pi);
  registerResourceHooks(pi);
}
