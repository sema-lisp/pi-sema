import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { hasSemaFiles } from "../sema.js";

export function registerResourceHooks(pi: ExtensionAPI): void {
  pi.on("resources_discover", async (event, ctx) => {
    if (!hasSemaFiles()) return {};

    return {
      skillPaths: [],
      promptPaths: [],
      themePaths: [],
    };
  });
}
