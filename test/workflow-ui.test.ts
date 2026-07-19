import { describe, expect, it, vi } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { foldEvents } from "../src/workflows/model.js";
import {
  toWorkflowRunDetails,
  type WorkflowToolDetails,
} from "../src/ui/workflow-view.js";
import {
  renderWorkflowCall,
  renderWorkflowResult,
} from "../src/ui/workflow-tool.js";
import { WorkflowRunWidget } from "../src/ui/workflow-widget.js";

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  italic: (text: string) => text,
  underline: (text: string) => text,
  inverse: (text: string) => text,
  strikethrough: (text: string) => text,
} as unknown as Theme;

function runningState() {
  return foldEvents([
    {
      event: "run.started",
      seq: 0,
      ts: "t",
      workflow: "publish",
      run_id: "run-1",
      phases: ["Draft", "Verify"],
    },
    { event: "phase.started", seq: 1, ts: "t", phase: "Draft" },
    ...Array.from({ length: 8 }, (_, index) => ({
      event: "agent.started",
      seq: index + 2,
      ts: "t",
      agent_id: `writer_${index}`,
      agent_name: "writer",
    })),
    {
      event: "agent.tool_call",
      seq: 10,
      ts: "t",
      agent_id: "writer_7",
      tool_name: "file/write\nunsafe\u001b[2J",
    },
  ]);
}

describe("workflow run details", () => {
  it("creates a stable JSON-serializable snapshot", () => {
    const state = runningState();
    const details = toWorkflowRunDetails(state);

    expect(Array.isArray(details.agents)).toBe(true);
    expect(() => JSON.stringify(details)).not.toThrow();
    state.agents.get("writer_7")!.toolCalls.push({ tool: "later", ts: "t" });
    expect(details.agents.at(-1)?.toolCalls).toHaveLength(1);
  });
});

describe("workflow tool rendering", () => {
  it("sanitizes the call and reuses its text component", () => {
    const first = renderWorkflowCall(
      { workflow: "publish\n\u001b]52;c;secret\u0007", resume: "run-1" },
      theme,
      { lastComponent: undefined },
    );
    const second = renderWorkflowCall(
      { workflow: "publish", resume: "run-1" },
      theme,
      { lastComponent: first },
    );

    expect(second).toBe(first);
    expect(second.render(30).join(" ")).not.toMatch(/[\r\n\u001b]|secret/u);
  });

  it("renders focused live status when partial and every phase when expanded", () => {
    const run = toWorkflowRunDetails(runningState());
    const result = {
      content: [{ type: "text" as const, text: "progress" }],
      details: { runId: run.runId, run } satisfies WorkflowToolDetails,
    };
    const partial = renderWorkflowResult(
      result,
      { expanded: false, isPartial: true },
      theme,
      { lastComponent: undefined },
    ).render(32);
    const expanded = renderWorkflowResult(
      result,
      { expanded: true, isPartial: false },
      theme,
      { lastComponent: undefined },
    ).render(32);

    expect(partial.join(" ")).toContain("Draft");
    expect(partial.join(" ")).toContain("writer_7");
    expect(expanded.join(" ")).toContain("Draft");
    expect(expanded.join(" ")).toContain("Verify");
    expect(
      [...partial, ...expanded].every((row) => visibleWidth(row) <= 32),
    ).toBe(true);
  });
});

describe("workflow live widget", () => {
  it("keeps the current phase and latest agents within five terminal rows", () => {
    const requestRender = vi.fn();
    const widget = new WorkflowRunWidget(
      { requestRender },
      theme,
      toWorkflowRunDetails(runningState()),
    );

    const rows = widget.render(24);
    expect(rows.length).toBeLessThanOrEqual(5);
    expect(rows.join(" ")).toContain("Draft");
    expect(rows.join(" ")).toContain("writer_7");
    expect(
      rows.every((row) => !row.includes("\n") && visibleWidth(row) <= 24),
    ).toBe(true);

    widget.update(toWorkflowRunDetails(runningState()));
    expect(requestRender).toHaveBeenCalledOnce();
  });
});
