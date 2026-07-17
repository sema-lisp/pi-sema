import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isSemaInstalled, semaVersion } from "./sema.js";

export function registerMCP(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    if (!isSemaInstalled()) {
      ctx.ui.notify("Sema binary not found on PATH. Run 'cargo install sema-lang' or visit sema-lang.com.", "warning");
      return;
    }
  });
}
