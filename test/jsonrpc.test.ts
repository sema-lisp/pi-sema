import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import { JsonRpcClient, JsonRpcError } from "../src/bridge/jsonrpc.js";

function makePair() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const client = new JsonRpcClient(stdin, stdout);
  const written: string[] = [];
  stdin.on("data", (d: Buffer) => written.push(d.toString()));
  return { client, stdout, written };
}

describe("JsonRpcClient", () => {
  it("round-trips a request/response", async () => {
    const { client, stdout, written } = makePair();
    const promise = client.request("tools/list", {});
    await new Promise((r) => setImmediate(r));
    const sent = JSON.parse(written.join("").split("\n")[0]);
    expect(sent.method).toBe("tools/list");
    stdout.write(JSON.stringify({ jsonrpc: "2.0", id: sent.id, result: { tools: [] } }) + "\n");
    await expect(promise).resolves.toEqual({ tools: [] });
  });

  it("handles a response split across chunks", async () => {
    const { client, stdout, written } = makePair();
    const promise = client.request<string>("ping");
    await new Promise((r) => setImmediate(r));
    const sent = JSON.parse(written.join("").split("\n")[0]);
    const line = JSON.stringify({ jsonrpc: "2.0", id: sent.id, result: "pong" }) + "\n";
    stdout.write(line.slice(0, 10));
    await new Promise((r) => setImmediate(r));
    stdout.write(line.slice(10));
    await expect(promise).resolves.toBe("pong");
  });

  it("demultiplexes out-of-order responses", async () => {
    const { client, stdout, written } = makePair();
    const a = client.request("a");
    const b = client.request("b");
    await new Promise((r) => setImmediate(r));
    const [reqA, reqB] = written.join("").trim().split("\n").map((l) => JSON.parse(l));
    stdout.write(JSON.stringify({ jsonrpc: "2.0", id: reqB.id, result: "B" }) + "\n");
    stdout.write(JSON.stringify({ jsonrpc: "2.0", id: reqA.id, result: "A" }) + "\n");
    await expect(b).resolves.toBe("B");
    await expect(a).resolves.toBe("A");
  });

  it("maps JSON-RPC errors to JsonRpcError", async () => {
    const { client, stdout, written } = makePair();
    const promise = client.request("tools/call");
    await new Promise((r) => setImmediate(r));
    const sent = JSON.parse(written.join("").split("\n")[0]);
    stdout.write(
      JSON.stringify({ jsonrpc: "2.0", id: sent.id, error: { code: -32601, message: "method not found" } }) + "\n",
    );
    await expect(promise).rejects.toThrowError(JsonRpcError);
    await expect(promise).rejects.toMatchObject({ code: -32601 });
  });

  it("ignores non-JSON noise between lines", async () => {
    const { client, stdout, written } = makePair();
    const promise = client.request("ping");
    await new Promise((r) => setImmediate(r));
    const sent = JSON.parse(written.join("").split("\n")[0]);
    stdout.write("some stray log line\n");
    stdout.write(JSON.stringify({ jsonrpc: "2.0", id: sent.id, result: "ok" }) + "\n");
    await expect(promise).resolves.toBe("ok");
  });

  it("dispatches server notifications to handlers", async () => {
    const { client, stdout } = makePair();
    const received: unknown[] = [];
    client.onNotification("notifications/tools/list_changed", (params) => received.push(params ?? null));
    stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/tools/list_changed" }) + "\n");
    await new Promise((r) => setImmediate(r));
    expect(received).toHaveLength(1);
  });

  it("rejects all pending requests on dispose", async () => {
    const { client } = makePair();
    const promise = client.request("hang");
    client.dispose(new Error("server died"));
    await expect(promise).rejects.toThrow("server died");
    await expect(client.request("after")).rejects.toThrow("disposed");
  });

  it("times out requests", async () => {
    const { client } = makePair();
    await expect(client.request("never", {}, 20)).rejects.toThrow(/timed out/);
  });
});
