import type {
  AgentToolResult,
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { Text, type Component } from "@earendil-works/pi-tui";
import { sanitizeDisplayText } from "./text.js";
import {
  formatWorkflowDetailsRows,
  type WorkflowToolDetails,
} from "./workflow-view.js";

interface WorkflowCallArgs {
  workflow?: string;
  resume?: string;
}

interface ReusableRenderContext {
  lastComponent: Component | undefined;
}

export function renderWorkflowCall(
  args: WorkflowCallArgs,
  theme: Theme,
  context: ReusableRenderContext,
): Component {
  const workflow = sanitizeDisplayText(args.workflow) || "workflow";
  const resume = sanitizeDisplayText(args.resume);
  const value =
    theme.fg("toolTitle", theme.bold("sema workflow ")) +
    theme.fg("accent", workflow) +
    (resume ? theme.fg("muted", ` · resume ${resume}`) : "");
  return updateText(context.lastComponent, value);
}

export function renderWorkflowResult(
  result: AgentToolResult<WorkflowToolDetails>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: ReusableRenderContext,
): Component {
  const run = result.details?.run;
  if (!run) {
    const fallback = result.content
      .filter(
        (part): part is { type: "text"; text: string } => part.type === "text",
      )
      .map((part) => sanitizeDisplayText(part.text))
      .filter(Boolean)
      .join(" ");
    return updateText(
      context.lastComponent,
      theme.fg(result.details?.isError ? "error" : "toolOutput", fallback),
    );
  }

  const rows = formatWorkflowDetailsRows(run, {
    expanded: options.expanded,
    maxAgents: options.expanded ? 12 : 3,
  });
  const color = options.isPartial
    ? "warning"
    : run.status === "success"
      ? "success"
      : run.status === "live"
        ? "warning"
        : "error";
  const text = rows
    .map((row, index) =>
      index === 0 ? theme.fg(color, row) : theme.fg("toolOutput", row),
    )
    .join("\n");
  return updateText(context.lastComponent, text);
}

function updateText(previous: Component | undefined, value: string): Text {
  const text = previous instanceof Text ? previous : new Text("", 0, 0);
  text.setText(value);
  return text;
}
