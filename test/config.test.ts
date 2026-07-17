import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG, mergeConfig } from "../src/config.js";

describe("mergeConfig", () => {
  it("returns defaults when no overlays", () => {
    const cfg = mergeConfig(DEFAULT_CONFIG);
    expect(cfg).toEqual(DEFAULT_CONFIG);
    expect(cfg).not.toBe(DEFAULT_CONFIG); // cloned, not aliased
  });

  it("deep-merges nested sections without clobbering siblings", () => {
    const cfg = mergeConfig(DEFAULT_CONFIG, {
      sandbox: { workflows: "strict" },
    });
    expect(cfg.sandbox.workflows).toBe("strict");
    expect(cfg.sandbox.mcp).toBe("all"); // sibling untouched
  });

  it("later overlays win (project over global)", () => {
    const cfg = mergeConfig(
      DEFAULT_CONFIG,
      { forge: { maxRounds: 5 } },
      { forge: { maxRounds: 2 } },
    );
    expect(cfg.forge.maxRounds).toBe(2);
    expect(cfg.forge.probeTimeoutMs).toBe(15_000);
  });

  it("arrays replace rather than merge", () => {
    const cfg = mergeConfig(DEFAULT_CONFIG, { excludeTools: ["docs"] });
    expect(cfg.excludeTools).toEqual(["docs"]);
  });

  it("null overlays are skipped", () => {
    const cfg = mergeConfig(DEFAULT_CONFIG, null, {
      ui: { dashboardShortcut: "ctrl+w" },
    });
    expect(cfg.ui.dashboardShortcut).toBe("ctrl+w");
  });
});
