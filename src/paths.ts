import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

export type TierName = "project" | "global";

export interface Tier {
  name: TierName;
  root: string;
}

/** Global tier lives under pi's own agent dir: ~/.pi/agent/pi-sema */
export function globalRoot(): string {
  return join(homedir(), ".pi", "agent", "pi-sema");
}

/** Project tier follows pi's project-local convention: <cwd>/.pi/pi-sema */
export function projectRoot(cwd: string): string {
  return join(cwd, ".pi", "pi-sema");
}

/** Tiers in precedence order — project shadows global. */
export function tiers(cwd: string): Tier[] {
  return [
    { name: "project", root: projectRoot(cwd) },
    { name: "global", root: globalRoot() },
  ];
}

export function tierRoot(cwd: string, name: TierName): string {
  return name === "project" ? projectRoot(cwd) : globalRoot();
}

/** Created lazily on first write — session start must not scatter dirs into repos. */
export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}
