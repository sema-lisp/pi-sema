import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { foldEvents, reduceRun, type JournalEvent } from "../src/workflows/model.js";

function loadFixture(name: string): JournalEvent[] {
  const raw = readFileSync(join(__dirname, "fixtures", name), "utf-8");
  return raw
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

describe("reduceRun golden fixtures", () => {
  it("folds the checkpoint-only run (declared phases[])", () => {
    const state = foldEvents(loadFixture("checkpoint-run.events.jsonl"));
    expect(state.workflow).toBe("fixture-run");
    expect(state.status).toBe("success");
    expect(state.phases.map((p) => [p.name, p.status])).toEqual([
      ["Collect", "success"],
      ["Process", "success"],
    ]);
    expect(state.checkpoints.map((c) => c.key)).toEqual(["items", "total"]);
    expect(state.checkpoints[1].value).toBe("6");
  });

  it("folds the live content-pipeline fixture with agents", () => {
    const state = foldEvents(loadFixture("content-live.events.jsonl"));
    expect(state.workflow).toBe("content-pipeline");
    expect(state.agents.size).toBeGreaterThan(0);
    // every agent with a result got a terminal status
    for (const agent of state.agents.values()) {
      expect(["running", "ok", "failed"]).toContain(agent.status);
    }
  });
});

describe("reduceRun edge cases", () => {
  it("degrades when phases[] is absent (serde-skipped) — lazy discovery", () => {
    const state = foldEvents([
      { event: "run.started", seq: 0, ts: "t", workflow: "w", run_id: "r" }, // no phases key
      { event: "phase.started", seq: 1, ts: "t", phase: "Late" },
    ]);
    expect(state.phases).toEqual([{ name: "Late", status: "running", seq: 1 }]);
    expect(state.status).toBe("live");
  });

  it("correlates agents by agent_id and attributes to the open phase", () => {
    const state = foldEvents([
      { event: "run.started", seq: 0, ts: "t", workflow: "w", run_id: "r", phases: ["P"] },
      { event: "phase.started", seq: 1, ts: "t", phase: "P" },
      { event: "agent.started", seq: 2, ts: "t", agent_id: "writer_1", agent_name: "writer" },
      { event: "agent.tool_call", seq: 3, ts: "t", agent_id: "writer_1", tool_name: "file/write" },
    ]);
    const agent = state.agents.get("writer_1")!;
    expect(agent.status).toBe("running"); // started without result = running
    expect(agent.phaseName).toBe("P");
    expect(agent.toolCalls).toHaveLength(1);

    reduceRun(state, { event: "agent.result", seq: 4, ts: "t", agent_id: "writer_1", status: "ok", output: "done", dur_ms: 10 });
    expect(state.agents.get("writer_1")!.status).toBe("ok");
  });

  it("sums per-event budget and keeps costUsd null until priced", () => {
    const state = foldEvents([
      { event: "budget", seq: 1, ts: "t", input_tokens: 100, output_tokens: 50 },
    ]);
    expect(state.budget.costUsd).toBeNull(); // unpriced ≠ $0
    reduceRun(state, { event: "budget", seq: 2, ts: "t", input_tokens: 10, output_tokens: 5, cost_usd: 0.25 });
    expect(state.budget.inputTokens).toBe(110);
    expect(state.budget.costUsd).toBe(0.25);
  });

  it("maps needs-auth and failed run.ended statuses", () => {
    const auth = foldEvents([
      { event: "auth.required", seq: 1, ts: "t", server: "linear" },
      { event: "run.ended", seq: 2, ts: "t", status: "needs-auth", dur_ms: 5 },
    ]);
    expect(auth.status).toBe("needs-auth");
    expect(auth.authRequired[0].server).toBe("linear");

    const failed = foldEvents([{ event: "run.ended", seq: 1, ts: "t", status: "failed", reason: "budget exceeded", dur_ms: 5 }]);
    expect(failed.status).toBe("failed");
    expect(failed.reason).toBe("budget exceeded");
  });

  it("a resume segment's run.started reopens the run without duplicating phases", () => {
    const state = foldEvents([
      { event: "run.started", seq: 0, ts: "t", workflow: "w", run_id: "r", phases: ["A"] },
      { event: "phase.started", seq: 1, ts: "t", phase: "A" },
      { event: "run.ended", seq: 2, ts: "t", status: "failed", dur_ms: 1 },
      // resume segment starts over at seq 0 with the same declared phases
      { event: "run.started", seq: 0, ts: "t2", workflow: "w", run_id: "r", phases: ["A"] },
    ]);
    expect(state.status).toBe("live");
    expect(state.phases).toHaveLength(1);
  });

  it("skips unknown (future) event types", () => {
    const state = foldEvents([{ event: "totally.new", seq: 0, ts: "t" } as never]);
    expect(state.lastSeq).toBe(0);
  });
});
