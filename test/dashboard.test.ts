import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  DashboardComponent,
  listRuns,
  type RunListingCache,
} from "../src/ui/dashboard.js";
import { formatRunSummary, formatRunLines } from "../src/ui/format.js";
import { foldEvents, type JournalEvent } from "../src/workflows/model.js";

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

const theme = {
  fg: (_color: string, text: string) => `\u001b[36m${text}\u001b[0m`,
  bg: (_color: string, text: string) => `\u001b[44m${text}\u001b[0m`,
  bold: (text: string) => `\u001b[1m${text}\u001b[0m`,
} as unknown as Theme;

describe("listRuns", () => {
  it("lists run dirs newest-first and marks liveness by absent run.ended", () => {
    writeRun("finished", [
      {
        event: "run.started",
        seq: 0,
        ts: "t",
        workflow: "a",
        run_id: "finished",
      },
      { event: "run.ended", seq: 1, ts: "t", status: "success", dur_ms: 5 },
    ]);
    writeRun("running", [
      {
        event: "run.started",
        seq: 0,
        ts: "t",
        workflow: "b",
        run_id: "running",
      },
    ]);
    mkdirSync(join(root, "not-a-run")); // no journal → skipped

    const runs = listRuns(root);
    expect(runs).toHaveLength(2);
    expect(runs.find((r) => r.runId === "running")!.live).toBe(true);
    expect(runs.find((r) => r.runId === "finished")!.live).toBe(false);
  });

  it("returns empty for a missing root", () => {
    expect(listRuns(join(root, "nope"))).toEqual([]);
  });

  it("reuses unchanged folds and invalidates on a newer resume segment", () => {
    writeRun("resumed", [
      {
        event: "run.started",
        seq: 0,
        ts: "t",
        workflow: "publish",
        run_id: "resumed",
      },
    ]);
    const cache: RunListingCache = new Map();

    const first = listRuns(root, cache)[0];
    const unchanged = listRuns(root, cache)[0];
    expect(unchanged.state).toBe(first.state);

    const resumedAt = new Date(Date.now() + 10_000);
    const resumePath = join(root, "resumed", "events.resume-1.jsonl");
    writeFileSync(
      resumePath,
      line({
        event: "run.ended",
        seq: 1,
        ts: "t",
        status: "success",
      }),
    );
    utimesSync(resumePath, resumedAt, resumedAt);

    const resumed = listRuns(root, cache)[0];
    expect(resumed.state).not.toBe(first.state);
    expect(resumed.state.status).toBe("success");
    expect(resumed.mtimeMs).toBe(resumedAt.getTime());
  });
});

describe("DashboardComponent", () => {
  it("keeps detail rows safe and scrollable inside its viewport", () => {
    const phases = Array.from({ length: 12 }, (_, index) => `Phase ${index}`);
    const events: object[] = [
      {
        event: "run.started",
        seq: 0,
        ts: "t",
        workflow: "publish",
        run_id: "finished",
        phases,
      },
    ];
    for (let index = 0; index < phases.length; index++) {
      events.push(
        {
          event: "phase.started",
          seq: index * 2 + 1,
          ts: "t",
          phase: phases[index],
        },
        {
          event: "phase.ended",
          seq: index * 2 + 2,
          ts: "t",
          phase: phases[index],
          status: "success",
        },
      );
    }
    events.push(
      {
        event: "checkpoint",
        seq: 30,
        ts: "t",
        key: "unsafe\nkey",
        value: "row one\nrow two\u001b]52;c;secret\u0007",
      },
      { event: "run.ended", seq: 31, ts: "t", status: "success" },
    );
    writeRun("finished", events);
    writeFileSync(
      join(root, "finished", "result.json"),
      JSON.stringify({ value: "done\n\u001b[2J" }),
    );

    const component = new DashboardComponent(root, {
      requestRender() {},
      done() {},
      theme,
      maxHeight: () => 9,
      refreshMs: false,
    });
    component.handleInput("\r");
    component.handleInput("G");
    const rows = component.render(32);

    expect(rows.length).toBeLessThanOrEqual(9);
    expect(
      rows.every((row) => !row.includes("\n") && visibleWidth(row) <= 32),
    ).toBe(true);
    expect(rows.join(" ")).not.toContain("secret");
    expect(rows.join(" ")).toContain("Result:");
    expect(rows.at(-2)).toContain("of");
    component.dispose();
  });

  it("stops showing LIVE and exposes the result when the tail ends", () => {
    writeRun("live", [
      {
        event: "run.started",
        seq: 0,
        ts: "t",
        workflow: "publish",
        run_id: "live",
        phases: ["Verify"],
      },
      { event: "phase.started", seq: 1, ts: "t", phase: "Verify" },
    ]);
    writeFileSync(
      join(root, "live", "result.json"),
      JSON.stringify({ value: "published" }),
    );
    let emit: ((events: JournalEvent[]) => void) | undefined;
    let stopped = false;
    const component = new DashboardComponent(root, {
      requestRender() {},
      done() {},
      theme,
      maxHeight: () => 10,
      refreshMs: false,
      tailerFactory(onEvents) {
        emit = onEvents;
        return {
          start() {},
          stop() {
            stopped = true;
          },
        };
      },
    });
    component.handleInput("\r");
    expect(component.render(40).join(" ")).toContain("LIVE");

    emit?.([
      {
        event: "run.started",
        seq: 0,
        ts: "t",
        workflow: "publish",
        run_id: "live",
        phases: ["Verify"],
      },
      { event: "phase.started", seq: 1, ts: "t", phase: "Verify" },
      {
        event: "phase.ended",
        seq: 2,
        ts: "t",
        phase: "Verify",
        status: "success",
      },
      { event: "run.ended", seq: 3, ts: "t", status: "success" },
    ]);
    component.handleInput("G");
    const finished = component.render(40).join(" ");

    expect(finished).not.toContain("LIVE");
    expect(finished).toContain("Result:");
    expect(stopped).toBe(true);
    component.dispose();
  });

  it("loads a result file that appears just after run.ended", async () => {
    vi.useFakeTimers();
    let component: DashboardComponent | undefined;
    try {
      writeRun("live", [
        {
          event: "run.started",
          seq: 0,
          ts: "t",
          workflow: "publish",
          run_id: "live",
        },
      ]);
      let emit: ((events: JournalEvent[]) => void) | undefined;
      component = new DashboardComponent(root, {
        requestRender() {},
        done() {},
        theme,
        maxHeight: () => 8,
        refreshMs: 25,
        tailerFactory(onEvents) {
          emit = onEvents;
          return { start() {}, stop() {} };
        },
      });
      component.handleInput("\r");
      emit?.([
        {
          event: "run.started",
          seq: 0,
          ts: "t",
          workflow: "publish",
          run_id: "live",
        },
        { event: "run.ended", seq: 1, ts: "t", status: "success" },
      ]);
      expect(component.render(40).join(" ")).not.toContain("Result:");

      writeFileSync(
        join(root, "live", "result.json"),
        JSON.stringify({ value: "published later" }),
      );
      await vi.advanceTimersByTimeAsync(25);
      component.handleInput("G");

      expect(component.render(40).join(" ")).toContain("Result:");
    } finally {
      component?.dispose();
      vi.useRealTimers();
    }
  });
});

describe("run rendering", () => {
  it("summarizes a live run with phases and agents", () => {
    const state = foldEvents([
      {
        event: "run.started",
        seq: 0,
        ts: "t",
        workflow: "content",
        run_id: "r",
        phases: ["Write", "Verify"],
      },
      { event: "phase.started", seq: 1, ts: "t", phase: "Write" },
      {
        event: "agent.started",
        seq: 2,
        ts: "t",
        agent_id: "writer_1",
        agent_name: "writer",
      },
      {
        event: "agent.tool_call",
        seq: 3,
        ts: "t",
        agent_id: "writer_1",
        tool_name: "file/write",
      },
      {
        event: "budget",
        seq: 4,
        ts: "t",
        input_tokens: 1000,
        output_tokens: 500,
        cost_usd: 0.12,
      },
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
