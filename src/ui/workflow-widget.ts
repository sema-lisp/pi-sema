import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { fitRow } from "./text.js";
import {
  formatWorkflowDetailsRows,
  type WorkflowRunDetails,
} from "./workflow-view.js";

export class WorkflowRunWidget implements Component {
  constructor(
    private readonly tui: Pick<TUI, "requestRender">,
    private readonly theme: Theme,
    private details?: WorkflowRunDetails,
  ) {}

  update(details: WorkflowRunDetails): void {
    this.details = details;
    this.tui.requestRender();
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (!this.details || width <= 0) return [];
    return formatWorkflowDetailsRows(this.details, {
      expanded: false,
      maxAgents: 3,
    })
      .slice(0, 5)
      .map((row, index) =>
        fitRow(
          index === 0
            ? this.theme.fg("accent", this.theme.bold(row))
            : this.theme.fg("muted", row),
          width,
        ),
      );
  }
}

export interface WorkflowWidgetHandle {
  update(details: WorkflowRunDetails): void;
  clear(): void;
}

/** Install one mutable widget component for a workflow tool invocation. */
export function installWorkflowRunWidget(
  ctx: ExtensionContext,
  key: string,
): WorkflowWidgetHandle {
  let latest: WorkflowRunDetails | undefined;
  let component: WorkflowRunWidget | undefined;
  let cleared = false;

  if (ctx.mode === "tui") {
    try {
      ctx.ui.setWidget(key, (tui, theme) => {
        component = new WorkflowRunWidget(tui, theme, latest);
        return component;
      });
    } catch {
      // Other UI implementations may reject terminal components.
    }
  }

  return {
    update(details) {
      if (cleared) return;
      latest = details;
      component?.update(details);
    },
    clear() {
      if (cleared) return;
      cleared = true;
      component = undefined;
      try {
        ctx.ui.setWidget(key, undefined);
      } catch {
        // The execution result is still valid when no TUI is attached.
      }
    },
  };
}
