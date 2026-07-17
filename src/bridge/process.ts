import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { JsonRpcClient, mcpInitialize } from "./jsonrpc.js";

export interface McpProcessOptions {
  /** .sema files evaluated into the server env at startup (stored tool libraries). */
  toolFiles: string[];
  cwd: string;
  /** Passed as --sandbox when set and supported by the installed sema (feature-detected upstream). */
  sandbox?: string;
  onCrash?: (code: number | null) => void;
}

/**
 * Lifecycle owner for the ONE long-lived `sema mcp` child per session.
 * Never restarted mid-session — forged tools are injected live via its eval
 * tool; the only restart path is session reload (session_shutdown → respawn).
 */
export class McpProcess {
  private child: ChildProcessWithoutNullStreams | null = null;
  private _client: JsonRpcClient | null = null;
  private stopping = false;
  private restarted = false;

  constructor(private readonly opts: McpProcessOptions) {}

  get client(): JsonRpcClient {
    if (!this._client) throw new Error("sema mcp process not started");
    return this._client;
  }

  get running(): boolean {
    return this.child !== null && this.child.exitCode === null;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  get hasRestarted(): boolean {
    return this.restarted;
  }

  async start(): Promise<void> {
    // Tool exclusion happens bridge-side (glob-aware, no --include/--exclude
    // flags): --include would hide later-forged tools, and --exclude wants
    // concrete names we only learn from tools/list after the server is up.
    const args = ["mcp", ...this.opts.toolFiles];
    if (this.opts.sandbox) args.push("--sandbox", this.opts.sandbox);

    const child = spawn("sema", args, {
      cwd: this.opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    this.stopping = false;

    let stderrTail = "";
    child.stderr.on("data", (d: Buffer) => {
      stderrTail = (stderrTail + d.toString("utf-8")).slice(-2000);
    });

    child.on("close", (code) => {
      this._client?.dispose(
        new Error(`sema mcp exited (code ${code}): ${stderrTail.trim()}`),
      );
      this._client = null;
      this.child = null;
      if (!this.stopping) {
        // Crash: allow a single automatic restart; repeated crashes surface to the caller.
        if (!this.restarted) {
          this.restarted = true;
          setTimeout(() => {
            if (!this.stopping)
              void this.start().catch(() => this.opts.onCrash?.(code));
          }, 1000).unref();
        } else {
          this.opts.onCrash?.(code);
        }
      }
    });

    this._client = new JsonRpcClient(
      child.stdin,
      child.stdout,
      () =>
        ` (exit code ${child.exitCode ?? "?"}; stderr tail: ${stderrTail.trim() || "<empty>"})`,
    );
    try {
      await mcpInitialize(this._client);
      this.restarted = false; // healthy start resets the crash budget
    } catch (err) {
      const detail = stderrTail.trim();
      await this.stop();
      throw new Error(
        `sema mcp failed to initialize${detail ? `: ${detail}` : ""} (${err instanceof Error ? err.message : err})`,
      );
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    if (!child) return;
    this._client?.dispose();
    this._client = null;
    this.child = null;

    await new Promise<void>((resolve) => {
      const done = () => resolve();
      child.once("close", done);
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 2000).unref();
      // Safety net if 'close' never fires.
      setTimeout(done, 4000).unref();
    });
  }
}
