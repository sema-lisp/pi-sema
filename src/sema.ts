import { execSync, exec } from "node:child_process";
import { existsSync } from "node:fs";

export interface SemaResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function resolveBinary(): string {
  return "sema";
}

export function isSemaInstalled(): boolean {
  try {
    execSync(`${resolveBinary()} --version`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function semaVersion(): string | null {
  try {
    return execSync(`${resolveBinary()} --version`, {
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
  } catch {
    return null;
  }
}

export function runSema(args: string[], timeoutMs = 30_000): SemaResult {
  const cmd = `${resolveBinary()} ${args.map(a => quoteArg(a)).join(" ")}`;
  try {
    const stdout = execSync(cmd, {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout: stdout.trim(), stderr: "", exitCode: 0 };
  } catch (err: any) {
    if (err?.stdout && err?.stderr) {
      return {
        stdout: err.stdout.toString().trim(),
        stderr: err.stderr.toString().trim(),
        exitCode: err.status ?? 1,
      };
    }
    if (err?.stderr) {
      return { stdout: "", stderr: err.stderr.toString().trim(), exitCode: err.status ?? 1 };
    }
    return { stdout: "", stderr: err?.message ?? String(err), exitCode: err?.status ?? 1 };
  }
}

export async function runSemaAsync(args: string[], timeoutMs = 30_000): Promise<SemaResult> {
  const bin = resolveBinary();
  return new Promise((resolve) => {
    const child = exec(`${bin} ${args.map(a => quoteArg(a)).join(" ")}`, {
      encoding: "utf-8",
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error && !stdout) {
        resolve({ stdout: stdout?.trim() ?? "", stderr: stderr?.trim() ?? error.message, exitCode: error.code ?? 1 });
      } else {
        resolve({ stdout: stdout?.trim() ?? "", stderr: stderr?.trim() ?? "", exitCode: 0 });
      }
    });
    if (timeoutMs > 0) {
      setTimeout(() => {
        child.kill();
        resolve({ stdout: "", stderr: "Timed out", exitCode: 124 });
      }, timeoutMs);
    }
  });
}

export function hasSemaFiles(): boolean {
  try {
    const result = execSync("fd --type f --extension sema . 2>/dev/null || find . -name '*.sema' -type f 2>/dev/null | head -5", {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 5_000,
    });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

function quoteArg(arg: string): string {
  if (/^[a-zA-Z0-9_./~-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}
