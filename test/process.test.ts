import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { McpProcess } from "../src/bridge/process.js";

interface FakeChild extends EventEmitter {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  exitCode: number | null;
  pid: number;
  kill: (signal?: NodeJS.Signals) => boolean;
}

function makeChild(pid: number): FakeChild {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    pid,
    kill: vi.fn(() => true),
  }) as FakeChild;
  let buffer = "";
  child.stdin.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf-8");
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const request = JSON.parse(line) as { id?: number };
      if (request.id !== undefined) {
        child.stdout.write(
          JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {} }) + "\n",
        );
      }
    }
  });
  return child;
}

function crash(child: FakeChild, code = 23): void {
  child.exitCode = code;
  child.emit("close", code);
}

afterEach(() => {
  vi.useRealTimers();
  spawnMock.mockReset();
});

describe("McpProcess", () => {
  it("attempts only one automatic restart after healthy children crash", async () => {
    vi.useFakeTimers();
    const first = makeChild(1);
    const second = makeChild(2);
    const onCrash = vi.fn();
    spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const mcp = new McpProcess({
      toolFiles: [],
      cwd: process.cwd(),
      onCrash,
    });

    await mcp.start();
    crash(first);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(spawnMock).toHaveBeenCalledTimes(2);

    crash(second);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(onCrash).toHaveBeenCalledWith(23);
    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(mcp.hasRestarted).toBe(true);
  });
});
