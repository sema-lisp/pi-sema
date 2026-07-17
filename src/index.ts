import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isSemaInstalled, semaVersion } from "./sema.js";
import { loadConfig, registerConfigFlags } from "./config.js";
import { registerContextHooks } from "./hooks/context.js";
import { registerResourceHooks } from "./hooks/resources.js";

export default function (pi: ExtensionAPI) {
  registerConfigFlags(pi);

  pi.on("session_start", async (_event, ctx) => {
    if (!(await isSemaInstalled())) {
      ctx.ui.notify(
        "sema binary not found on PATH. Install: curl -fsSL https://sema-lang.com/install.sh | sh",
        "warning",
      );
      return;
    }
    const version = await semaVersion();
    ctx.ui.setStatus("sema", version ?? "sema");
    // Config is loaded per-session so project-tier config.json is honored.
    loadConfig(ctx.cwd, pi, (msg) => ctx.ui.notify(msg, "warning"));
  });

  registerContextHooks(pi);
  registerResourceHooks(pi);
}
