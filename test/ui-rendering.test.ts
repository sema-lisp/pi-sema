import { describe, expect, it } from "vitest";
import { formatRunLines, formatRunSummary } from "../src/ui/format.js";
import { foldEvents } from "../src/workflows/model.js";

describe("workflow display formatting", () => {
  it("names the final phase when a run has finished", () => {
    const state = foldEvents([
      {
        event: "run.started",
        seq: 0,
        ts: "t",
        workflow: "publish",
        run_id: "r",
        phases: ["Draft", "Verify"],
      },
      { event: "phase.started", seq: 1, ts: "t", phase: "Draft" },
      {
        event: "phase.ended",
        seq: 2,
        ts: "t",
        phase: "Draft",
        status: "success",
      },
      { event: "phase.started", seq: 3, ts: "t", phase: "Verify" },
      {
        event: "phase.ended",
        seq: 4,
        ts: "t",
        phase: "Verify",
        status: "success",
      },
      { event: "run.ended", seq: 5, ts: "t", status: "success" },
    ]);

    expect(formatRunSummary(state)).toContain("Verify (2/2)");
    expect(formatRunSummary(state)).not.toContain("…");
  });

  it("keeps journal-derived values on one control-free terminal row", () => {
    const state = foldEvents([
      {
        event: "run.started",
        seq: 0,
        ts: "t",
        workflow: "unsafe\nworkflow\u001b]52;c;secret\u0007",
        run_id: "r",
        phases: ["Draft\r\nInjected"],
      },
      {
        event: "phase.started",
        seq: 1,
        ts: "t",
        phase: "Draft\r\nInjected",
      },
      {
        event: "run.ended",
        seq: 2,
        ts: "t",
        status: "failed",
        reason: "failed\nsecond row\u001b[2J",
      },
    ]);

    const rows = formatRunLines(state);
    expect(rows.every((row) => !/[\r\n\u001b\u0000-\u0008]/u.test(row))).toBe(
      true,
    );
    expect(rows.join(" ")).not.toContain("secret");
  });
});
