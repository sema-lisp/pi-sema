/**
 * Configuration — the effective `PiSemaConfig` for a session.
 *
 * WHAT: defines the config shape + defaults and resolves the layered value.
 *
 * HOW/WHY: layering is defaults ← global config.json ← project config.json ←
 * CLI flags, deep-merged in that order so the most specific source wins.
 * Configuration files are validated before merging: malformed values warn and
 * are skipped rather than taking the whole extension down at session start.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { globalRoot, projectRoot } from "./paths.js";
import type { TierName } from "./paths.js";

export interface PiSemaConfig {
  sandbox: {
    /** Sandbox for the long-lived `sema mcp` server. "all" | "strict" | comma caps ("no-fs-write,no-shell"). */
    mcp: string;
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
    /** Override for the run journal dir; null = <cwd>/.sema/runs. */
    runDir: string | null;
  };
  ui: {
    dashboardShortcut: string;
  };
}

export const DEFAULT_CONFIG: PiSemaConfig = {
  sandbox: { mcp: "all" },
  excludeTools: ["notebook/*"],
  library: { defaultTier: "project" },
  forge: { maxRounds: 3, probeTimeoutMs: 15_000 },
  workflows: { runDir: null },
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
    return normalizeConfig(JSON.parse(raw), path, warn);
  } catch (err) {
    warn?.(
      `pi-sema: ignoring malformed config at ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

export const FLAG_SANDBOX = "sema-sandbox";
export const FLAG_EXCLUDE = "sema-exclude";

export function registerConfigFlags(pi: ExtensionAPI): void {
  pi.registerFlag(FLAG_SANDBOX, {
    description:
      "Sema MCP sandbox: all | strict | comma caps (e.g. no-fs-write,no-shell)",
    type: "string",
  });
  pi.registerFlag(FLAG_EXCLUDE, {
    description:
      "Comma-separated sema MCP tools to exclude (globs ok, e.g. notebook/*)",
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
      flagOverlay.sandbox = { mcp: sandbox };
    }
    const exclude = pi.getFlag(FLAG_EXCLUDE);
    if (typeof exclude === "string" && exclude) {
      flagOverlay.excludeTools = exclude
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  return mergeConfig(DEFAULT_CONFIG, globalFile, projectFile, flagOverlay);
}

function normalizeConfig(
  value: unknown,
  path: string,
  warn?: (msg: string) => void,
): DeepPartial<PiSemaConfig> | null {
  if (!isRecord(value)) {
    warn?.(`pi-sema: ignoring malformed config at ${path}: expected an object`);
    return null;
  }

  const result: DeepPartial<PiSemaConfig> = {};
  const invalid = (key: string, expected: string) =>
    warn?.(
      `pi-sema: ignoring malformed config value ${key} at ${path}: expected ${expected}`,
    );

  if ("sandbox" in value) {
    if (!isRecord(value.sandbox)) invalid("sandbox", "an object");
    else {
      const sandbox: DeepPartial<PiSemaConfig["sandbox"]> = {};
      if ("mcp" in value.sandbox) {
        if (isNonEmptyString(value.sandbox.mcp))
          sandbox.mcp = value.sandbox.mcp.trim();
        else invalid("sandbox.mcp", "a non-empty string");
      }
      if ("workflows" in value.sandbox) {
        warn?.(
          `pi-sema: ignoring unsupported config value sandbox.workflows at ${path}: sema workflow run cannot enforce a CLI sandbox`,
        );
      }
      if (Object.keys(sandbox).length > 0) result.sandbox = sandbox;
    }
  }

  if ("excludeTools" in value) {
    if (
      Array.isArray(value.excludeTools) &&
      value.excludeTools.every(isNonEmptyString)
    ) {
      result.excludeTools = value.excludeTools.map((pattern) => pattern.trim());
    } else {
      invalid("excludeTools", "an array of non-empty strings");
    }
  }

  if ("library" in value) {
    if (!isRecord(value.library)) invalid("library", "an object");
    else if ("defaultTier" in value.library) {
      if (
        value.library.defaultTier === "project" ||
        value.library.defaultTier === "global"
      ) {
        result.library = { defaultTier: value.library.defaultTier };
      } else {
        invalid("library.defaultTier", '"project" or "global"');
      }
    }
  }

  if ("forge" in value) {
    if (!isRecord(value.forge)) invalid("forge", "an object");
    else {
      const forge: DeepPartial<PiSemaConfig["forge"]> = {};
      if ("maxRounds" in value.forge) {
        if (isPositiveInteger(value.forge.maxRounds)) {
          forge.maxRounds = value.forge.maxRounds;
        } else {
          invalid("forge.maxRounds", "a positive integer");
        }
      }
      if ("probeTimeoutMs" in value.forge) {
        if (isPositiveInteger(value.forge.probeTimeoutMs)) {
          forge.probeTimeoutMs = value.forge.probeTimeoutMs;
        } else {
          invalid("forge.probeTimeoutMs", "a positive integer");
        }
      }
      if (Object.keys(forge).length > 0) result.forge = forge;
    }
  }

  if ("workflows" in value) {
    if (!isRecord(value.workflows)) invalid("workflows", "an object");
    else {
      const workflows: DeepPartial<PiSemaConfig["workflows"]> = {};
      if ("runDir" in value.workflows) {
        if (
          value.workflows.runDir === null ||
          isNonEmptyString(value.workflows.runDir)
        ) {
          workflows.runDir = value.workflows.runDir;
        } else {
          invalid("workflows.runDir", "a string or null");
        }
      }
      if ("defaultBudgetUsd" in value.workflows) {
        warn?.(
          `pi-sema: ignoring unsupported config value workflows.defaultBudgetUsd at ${path}: sema workflow run has no run-level budget flag`,
        );
      }
      if (Object.keys(workflows).length > 0) result.workflows = workflows;
    }
  }

  if ("ui" in value) {
    if (!isRecord(value.ui)) invalid("ui", "an object");
    else if ("dashboardShortcut" in value.ui) {
      if (isNonEmptyString(value.ui.dashboardShortcut)) {
        result.ui = { dashboardShortcut: value.ui.dashboardShortcut };
      } else {
        invalid("ui.dashboardShortcut", "a non-empty string");
      }
    }
  }

  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
