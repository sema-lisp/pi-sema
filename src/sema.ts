/**
 * The `sema` binary interface — every child-process call goes through here.
 *
 * WHAT: `spawnSema` runs `sema <args>` to completion; plus cached probes
 * (`semaVersion`, `isSemaInstalled`) and a bounded `.sema`-file scan.
 *
 * HOW/WHY: timeout and abort are enforced here in Node because sema's own
 * `--timeout` flag is a parsed no-op — so this wrapper is load-bearing for
 * every LLM-heavy or possibly-hanging call. Version and file-scan results are
 * memoized so hot paths (per-turn hooks) do no repeated spawns or disk walks.
 */
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

export interface SpawnSemaOptions {
  /** Text piped to stdin (stream is closed after writing). */
  stdin?: string;
  /**
   * Hard timeout enforced by us. sema's own `--timeout` flag is a parsed
   * no-op (main.rs binds `timeout: _timeout`), so this is load-bearing.
   */
  timeoutMs?: number;
  signal?: AbortSignal;
  cwd?: string;
  env?: Record<string, string>;
}

export interface SpawnSemaResult {
  stdout: string;
  stderr: string;
  code: number | null;
  /** True when we terminated the process (timeout or abort), not sema itself. */
  killed: boolean;
}

const SEMA_BIN = "sema";

/** Run `sema <args>` to completion with caller-enforced timeout and abort. */
export function spawnSema(
  args: string[],
  opts: SpawnSemaOptions = {},
): Promise<SpawnSemaResult> {
  if (opts.signal?.aborted) {
    return Promise.resolve({
      stdout: "",
      stderr: "",
      code: null,
      killed: true,
    });
  }
  return new Promise((resolve) => {
    const child = spawn(SEMA_BIN, args, {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let killed = false;
    let settled = false;

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ stdout, stderr, code, killed });
    };

    const kill = () => {
      killed = true;
      child.kill("SIGTERM");
      // Escalate if SIGTERM is ignored.
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 2000).unref();
    };

    const timer = opts.timeoutMs ? setTimeout(kill, opts.timeoutMs) : undefined;
    timer?.unref();
    const onAbort = () => kill();
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    };

    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf-8")));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf-8")));
    child.on("error", (err) => {
      stderr ||= err.message;
      finish(null);
    });
    child.on("close", (code) => finish(code));

    if (opts.stdin !== undefined) {
      child.stdin.write(opts.stdin);
    }
    child.stdin.end();
  });
}

let versionCache: string | null | undefined;

/** `sema --version` output, cached for the process lifetime. Null = not installed. */
export async function semaVersion(): Promise<string | null> {
  if (versionCache !== undefined) return versionCache;
  const result = await spawnSema(["--version"], { timeoutMs: 5000 });
  versionCache = result.code === 0 ? result.stdout.trim() : null;
  return versionCache;
}

export async function isSemaInstalled(): Promise<boolean> {
  return (await semaVersion()) !== null;
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "target",
  "dist",
  ".worktrees",
  ".sema",
]);

const semaFilesCache = new Map<string, boolean>();

/** Pure-Node bounded scan for .sema files (no fd/find dependency). Cached per cwd. */
export function hasSemaFiles(cwd: string, maxDepth = 4): boolean {
  const cached = semaFilesCache.get(cwd);
  if (cached !== undefined) return cached;

  const found = scanForSema(cwd, maxDepth);
  semaFilesCache.set(cwd, found);
  return found;
}

function scanForSema(dir: string, depth: number): boolean {
  if (depth < 0) return false;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".sema")) return true;
  }
  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      !SKIP_DIRS.has(entry.name) &&
      !entry.name.startsWith(".")
    ) {
      if (scanForSema(join(dir, entry.name), depth - 1)) return true;
    }
  }
  return false;
}
