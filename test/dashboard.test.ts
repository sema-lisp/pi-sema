import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listRuns } from "../src/ui/dashboard.js";
import { formatRunSummary, formatRunLines } from "../src/ui/format.js";
import { foldEvents } from "../src/workflows/model.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pi-sema-dash-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const line = (ev: object) => JSON.stringify(ev) + "\n";

function writeRun(id: string, events: object[]): void {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "events.jsonl"), events.map(line).join(""));
}

describe("listRuns", () => {
  it("lists run dirs newest-first and marks liveness by absent run.ended", () => {
    writeRun("finished", [
      { event: "run.started", seq: 0, ts: "t", workflow: "a", run_id: "finished" },
      { event: "run.ended", seq: 1, ts: "t", status: "success", dur_ms: 5 },
    ]);
    writeRun("running", [{ event: "run.started", seq: 0, ts: "t", workflow: "b", run_id: "running" }]);
    mkdirSync(join(root, "not-a-run")); // no journal → skipped

    const runs = listRuns(root);
    expect(runs).toHaveLength(2);
    expect(runs.find((r) => r.runId === "running")!.live).toBe(true);
    expect(runs.find((r) => r.runId === "finished")!.live).toBe(false);
  });

  it("returns empty for a missing root", () => {
    expect(listRuns(join(root, "nope"))).toEqual([]);
  });
});

describe("run rendering", () => {
  it("summarizes a live run with phases and agents", () => {
    const state = foldEvents([
      { event: "run.started", seq: 0, ts: "t", workflow: "content", run_id: "r", phases: ["Write", "Verify"] },
      { event: "phase.started", seq: 1, ts: "t", phase: "Write" },
      { event: "agent.started", seq: 2, ts: "t", agent_id: "writer_1", agent_name: "writer" },
      { event: "agent.tool_call", seq: 3, ts: "t", agent_id: "writer_1", tool_name: "file/write" },
      { event: "budget", seq: 4, ts: "t", input_tokens: 1000, output_tokens: 500, cost_usd: 0.12 },
    ]);
    const summary = formatRunSummary(state);
    expect(summary).toContain("▶ content");
    expect(summary).toContain("Write (0/2)");
    expect(summary).toContain("1 live/1 agents");
    expect(summary).toContain("$0.12");

    const lines = formatRunLines(state).join("\n");
    expect(lines).toContain("◐ Write");
    expect(lines).toContain("○ Verify");
    expect(lines).toContain("writer_1 → file/write");
  });

  it("shows needs-auth guidance", () => {
    const state = foldEvents([
      { event: "run.started", seq: 0, ts: "t", workflow: "w", run_id: "r" },
      { event: "auth.required", seq: 1, ts: "t", server: "linear" },
      { event: "run.ended", seq: 2, ts: "t", status: "needs-auth", dur_ms: 1 },
    ]);
    expect(formatRunLines(state).join("\n")).toContain("sema mcp login linear");
  });
});
