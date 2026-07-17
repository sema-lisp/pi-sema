import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, relative, dirname, isAbsolute, resolve } from "node:path";
import { ensureDir, tiers, tierRoot } from "../paths.js";
import type { Tier, TierName } from "../paths.js";

export type ArtifactKind = "tools" | "workflows" | "agents";

export interface LibraryEntry {
  /** Logical name: relative path under the kind dir, without .sema (slashes allowed). */
  name: string;
  path: string;
  tier: TierName;
  kind: ArtifactKind;
}

/**
 * Tiered store for user-authored Sema artifacts. Tools, workflows, and agents
 * are deliberately separate kinds in separate directories — never conflated.
 * Project tier (<cwd>/.pi/pi-sema) shadows global (~/.pi/agent/pi-sema) by name.
 */
export class LibraryStore {
  constructor(private readonly cwd: string) {}

  list(kind: ArtifactKind): LibraryEntry[] {
    const seen = new Map<string, LibraryEntry>();
    for (const tier of tiers(this.cwd)) {
      for (const entry of scanKind(tier, kind)) {
        if (!seen.has(entry.name)) seen.set(entry.name, entry);
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** All artifact file paths for a kind, precedence-resolved (used as `sema mcp` filepath args). */
  filePaths(kind: ArtifactKind): string[] {
    return this.list(kind).map((e) => e.path);
  }

  save(tier: TierName, kind: ArtifactKind, name: string, source: string): string {
    const safe = sanitizeName(name);
    const path = join(tierRoot(this.cwd, tier), kind, ...safe.split("/")) + ".sema";
    ensureDir(dirname(path));
    writeFileSync(path, source.endsWith("\n") ? source : source + "\n", "utf-8");
    return path;
  }

  /** Resolve a logical name or a literal path to an artifact file. */
  resolve(kind: ArtifactKind, nameOrPath: string): LibraryEntry | null {
    if (nameOrPath.endsWith(".sema")) {
      const abs = isAbsolute(nameOrPath) ? nameOrPath : resolve(this.cwd, nameOrPath);
      if (existsSync(abs) && statSync(abs).isFile()) {
        return { name: nameOrPath, path: abs, tier: "project", kind };
      }
      return null;
    }
    const name = sanitizeName(nameOrPath);
    return this.list(kind).find((e) => e.name === name) ?? null;
  }

  read(entry: LibraryEntry): string {
    return readFileSync(entry.path, "utf-8");
  }
}

/** Names map to file paths: keep [a-z0-9_/-], reject traversal. */
export function sanitizeName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/\.sema$/, "")
    .replace(/[^a-zA-Z0-9_/-]/g, "_")
    .replace(/\/+/g, "/")
    .replace(/(^\/|\/$)/g, "");
  if (!cleaned || cleaned.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`invalid artifact name: ${JSON.stringify(name)}`);
  }
  return cleaned;
}

function scanKind(tier: Tier, kind: ArtifactKind): LibraryEntry[] {
  const root = join(tier.root, kind);
  const out: LibraryEntry[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".sema")) {
        out.push({
          name: relative(root, full).replace(/\.sema$/, "").split("\\").join("/"),
          path: full,
          tier: tier.name,
          kind,
        });
      }
    }
  };
  walk(root);
  return out;
}
