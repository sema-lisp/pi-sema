import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, loadConfig, mergeConfig } from "../src/config.js";

describe("mergeConfig", () => {
  it("returns defaults when no overlays", () => {
    const cfg = mergeConfig(DEFAULT_CONFIG);
    expect(cfg).toEqual(DEFAULT_CONFIG);
    expect(cfg).not.toBe(DEFAULT_CONFIG); // cloned, not aliased
  });

  it("deep-merges nested sections without clobbering siblings", () => {
    const cfg = mergeConfig(DEFAULT_CONFIG, {
      sandbox: { mcp: "strict" },
    });
    expect(cfg.sandbox.mcp).toBe("strict");
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

describe("loadConfig", () => {
  let home: string;
  let cwd: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "pi-sema-home-"));
    cwd = mkdtempSync(join(tmpdir(), "pi-sema-project-"));
    vi.stubEnv("HOME", home);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  function writeProjectConfig(value: unknown): void {
    const dir = join(cwd, ".pi", "pi-sema");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify(value));
  }

  it("warns and retains defaults for valid JSON with invalid field shapes", () => {
    writeProjectConfig({
      sandbox: null,
      excludeTools: "docs",
      forge: { maxRounds: 0 },
      workflows: { runDir: "" },
    });
    const warn = vi.fn();

    const cfg = loadConfig(cwd, undefined, warn);

    expect(cfg).toEqual(DEFAULT_CONFIG);
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it("warns and ignores unsupported workflow controls while retaining runDir", () => {
    writeProjectConfig({
      sandbox: { mcp: "strict", workflows: "strict" },
      workflows: { defaultBudgetUsd: 1, runDir: "runs" },
    });
    const warn = vi.fn();

    const cfg = loadConfig(cwd, undefined, warn);

    expect(cfg.sandbox.mcp).toBe("strict");
    expect(cfg.workflows.runDir).toBe("runs");
    expect(warn.mock.calls.flat().join("\n")).toContain("sandbox.workflows");
    expect(warn.mock.calls.flat().join("\n")).toContain(
      "workflows.defaultBudgetUsd",
    );
  });
});
