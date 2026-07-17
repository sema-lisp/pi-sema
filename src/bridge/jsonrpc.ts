import type { Readable, Writable } from "node:stream";

export interface JsonRpcErrorShape {
  code: number;
  message: string;
  data?: unknown;
}

export class JsonRpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "JsonRpcError";
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Minimal line-delimited JSON-RPC 2.0 client over stdio streams — the full
 * protocol surface `sema mcp` speaks (initialize/ping/tools/list/tools/call).
 * Hand-rolled on purpose: no SDK dependency for four methods.
 */
export class JsonRpcClient {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private buffer = "";
  private disposed = false;
  private notificationHandlers = new Map<string, (params: unknown) => void>();

  constructor(
    private readonly stdin: Writable,
    stdout: Readable,
    /**
     * Lazily-evaluated crash detail appended to the stdout-closed error.
     * Node fires the stream's 'close' BEFORE the child's 'close' (which waits
     * for all stdio), so the process-level rich error is deterministically
     * unreachable for pending-request rejection — this closure is how exit
     * code + stderr reach the caller.
     */
    private readonly closeDetail?: () => string,
  ) {
    stdout.on("data", (chunk: Buffer) => this.onData(chunk.toString("utf-8")));
    stdout.on("close", () =>
      this.dispose(
        new Error(`sema mcp stdout closed${this.closeDetail?.() ?? ""}`),
      ),
    );
  }

  request<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs = 30_000,
  ): Promise<T> {
    if (this.disposed)
      return Promise.reject(new Error("jsonrpc client disposed"));
    const id = this.nextId++;
    const line = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(`jsonrpc request ${method} timed out after ${timeoutMs}ms`),
        );
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });
      this.stdin.write(line, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.disposed) return;
    this.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  /** Handle a server-initiated notification (e.g. future notifications/tools/list_changed). */
  onNotification(method: string, handler: (params: unknown) => void): void {
    this.notificationHandlers.set(method, handler);
  }

  dispose(err?: Error): void {
    if (this.disposed) return;
    this.disposed = true;
    const reason = err ?? new Error("jsonrpc client disposed");
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.pending.clear();
  }

  private onData(text: string): void {
    this.buffer += text;
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // non-JSON noise on stdout — ignore
      }
      if (msg.id != null && this.pending.has(msg.id)) {
        const pending = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        clearTimeout(pending.timer);
        if (msg.error) {
          const e = msg.error as JsonRpcErrorShape;
          pending.reject(new JsonRpcError(e.code, e.message, e.data));
        } else {
          pending.resolve(msg.result);
        }
      } else if (msg.method && msg.id == null) {
        this.notificationHandlers.get(msg.method)?.(msg.params);
      }
      // Server-initiated *requests* are not part of sema mcp's surface — ignored.
    }
  }
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpContentBlock {
  type: string;
  text?: string;
  [k: string]: unknown;
}

export interface McpCallResult {
  content: McpContentBlock[];
  isError?: boolean;
}

export const MCP_PROTOCOL_VERSION = "2024-11-05";

/** initialize → notifications/initialized → ping sanity check. */
export async function mcpInitialize(client: JsonRpcClient): Promise<void> {
  await client.request("initialize", {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "pi-sema", version: "0.2.0" },
  });
  client.notify("notifications/initialized");
  await client.request("ping", {}, 5000);
}

export async function mcpListTools(client: JsonRpcClient): Promise<McpTool[]> {
  const result = await client.request<{ tools?: McpTool[] }>("tools/list", {});
  return result.tools ?? [];
}

export async function mcpCallTool(
  client: JsonRpcClient,
  name: string,
  args: unknown,
  timeoutMs = 120_000,
): Promise<McpCallResult> {
  const result = await client.request<McpCallResult>(
    "tools/call",
    { name, arguments: args ?? {} },
    timeoutMs,
  );
  return { content: result.content ?? [], isError: result.isError };
}
