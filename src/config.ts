import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { globalRoot, projectRoot } from "./paths.js";
import type { TierName } from "./paths.js";

export interface PiSemaConfig {
  sandbox: {
    /** Sandbox for the long-lived `sema mcp` server. "all" | "strict" | comma caps ("no-fs-write,no-shell"). */
    mcp: string;
    /** Sandbox for `sema workflow run`. Same grammar. */
    workflows: string;
  };
  /** MCP tools to hide. Globs allowed (resolved against tools/list; --exclude wants concrete names). */
  excludeTools: string[];
  library: {
    /** Default tier for forged tools when the model doesn't specify one. */
    defaultTier: TierName;
  };
  forge: {
    /** Max probe-refinement rounds before giving up. */
    maxRounds: number;
    probeTimeoutMs: number;
  };
  workflows: {
    /** Default budget cap injected into runs; null = no cap. */
    defaultBudgetUsd: number | null;
    /** Override for the run journal dir; null = <cwd>/.sema/runs. */
    runDir: string | null;
  };
  ui: {
    dashboardShortcut: string;
  };
}

export const DEFAULT_CONFIG: PiSemaConfig = {
  sandbox: { mcp: "all", workflows: "all" },
  excludeTools: ["notebook/*"],
  library: { defaultTier: "project" },
  forge: { maxRounds: 3, probeTimeoutMs: 15_000 },
  workflows: { defaultBudgetUsd: null, runDir: null },
  ui: { dashboardShortcut: "ctrl+alt+s" },
};

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export function mergeConfig(
  base: PiSemaConfig,
  ...overlays: (DeepPartial<PiSemaConfig> | null)[]
): PiSemaConfig {
  const result: PiSemaConfig = structuredClone(base);
  for (const overlay of overlays) {
    if (!overlay) continue;
    deepMerge(
      result as unknown as Record<string, unknown>,
      overlay as Record<string, unknown>,
    );
  }
  return result;
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const existing = target[key];
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      existing !== null &&
      typeof existing === "object" &&
      !Array.isArray(existing)
    ) {
      deepMerge(
        existing as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      target[key] = value;
    }
  }
}

function readConfigFile(
  path: string,
  warn?: (msg: string) => void,
): DeepPartial<PiSemaConfig> | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return null; // missing file is fine
  }
  try {
    return JSON.parse(raw) as DeepPartial<PiSemaConfig>;
  } catch (err) {
    warn?.(
      `pi-sema: ignoring malformed config at ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

export const FLAG_SANDBOX = "sema-sandbox";
export const FLAG_EXCLUDE = "sema-exclude";
export const FLAG_BUDGET = "sema-budget";

export function registerConfigFlags(pi: ExtensionAPI): void {
  pi.registerFlag(FLAG_SANDBOX, {
    description:
      "Sema sandbox for mcp + workflow runs: all | strict | comma caps (e.g. no-fs-write,no-shell)",
    type: "string",
  });
  pi.registerFlag(FLAG_EXCLUDE, {
    description:
      "Comma-separated sema MCP tools to exclude (globs ok, e.g. notebook/*)",
    type: "string",
  });
  pi.registerFlag(FLAG_BUDGET, {
    description: "Default workflow budget cap in USD",
    type: "string",
  });
}

/** Layering: defaults ← global config.json ← project config.json ← CLI flags. Never throws. */
export function loadConfig(
  cwd: string,
  pi?: ExtensionAPI,
  warn?: (msg: string) => void,
): PiSemaConfig {
  const globalFile = readConfigFile(join(globalRoot(), "config.json"), warn);
  const projectFile = readConfigFile(
    join(projectRoot(cwd), "config.json"),
    warn,
  );

  const flagOverlay: DeepPartial<PiSemaConfig> = {};
  if (pi) {
    const sandbox = pi.getFlag(FLAG_SANDBOX);
    if (typeof sandbox === "string" && sandbox) {
      flagOverlay.sandbox = { mcp: sandbox, workflows: sandbox };
    }
    const exclude = pi.getFlag(FLAG_EXCLUDE);
    if (typeof exclude === "string" && exclude) {
      flagOverlay.excludeTools = exclude
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    const budget = pi.getFlag(FLAG_BUDGET);
    if (typeof budget === "string" && budget && !Number.isNaN(Number(budget))) {
      flagOverlay.workflows = { defaultBudgetUsd: Number(budget) };
    }
  }

  return mergeConfig(DEFAULT_CONFIG, globalFile, projectFile, flagOverlay);
}
