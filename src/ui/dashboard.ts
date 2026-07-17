import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { matchesKey } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PiSemaRuntime } from "../index.js";
import { JournalTailer, readJournalEvents } from "../workflows/journal.js";
import { foldEvents, newRunState, reduceRun, type RunState } from "../workflows/model.js";
import { formatRunLines, formatRunSummary, formatMs } from "./format.js";
import { defaultRunRoot } from "../workflows/runner.js";
import { DEFAULT_CONFIG } from "../config.js";

interface RunListing {
  runId: string;
  dir: string;
  mtimeMs: number;
  state: RunState;
  live: boolean;
}

/** Scan the run root the same way GET /api/runs does: dirs with a journal, newest first. */
export function listRuns(runRoot: string): RunListing[] {
  let names: string[];
  try {
    names = readdirSync(runRoot);
  } catch {
    return [];
  }
  const runs: RunListing[] = [];
  for (const name of names) {
    const dir = join(runRoot, name);
    const journal = join(dir, "events.jsonl");
    try {
      const mtimeMs = statSync(journal).mtimeMs;
      const state = foldEvents(readJournalEvents(dir));
      runs.push({ runId: name, dir, mtimeMs, state, live: state.status === "live" });
    } catch {
      // not a run dir
    }
  }
  return runs.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export function registerDashboard(pi: ExtensionAPI, getRuntime: () => PiSemaRuntime | null): void {
  const open = async (ctx: ExtensionContext) => {
    if (ctx.mode !== "tui") {
      ctx.ui.notify("The workflow dashboard needs the TUI. Runs live in .sema/runs/ — inspect with `sema workflow view`.", "warning");
      return;
    }
    const runtime = getRuntime();
    const runRoot = defaultRunRoot(ctx.cwd, runtime?.cfg.workflows.runDir ?? null);
    await ctx.ui.custom<void>(
      (tui, _theme, _keybindings, done) => new DashboardComponent(runRoot, () => tui.requestRender(), done),
      { overlay: true, overlayOptions: { anchor: "center", width: "80%", maxHeight: "70%" } },
    );
  };

  pi.registerCommand("sema:workflows", {
    description: "Open the Sema workflow runs dashboard (live + historical)",
    handler: async (_args, ctx) => open(ctx),
  });
  pi.registerShortcut(readConfiguredShortcut() as never, {
    description: "Sema workflow runs dashboard",
    handler: open,
  });
}

/** Shortcut must be known at registration time — global config only (no cwd yet). */
function readConfiguredShortcut(): string {
  try {
    const raw = readFileSync(join(process.env.HOME ?? "", ".pi", "agent", "pi-sema", "config.json"), "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.ui?.dashboardShortcut === "string") return parsed.ui.dashboardShortcut;
  } catch {
    // fall through
  }
  return DEFAULT_CONFIG.ui.dashboardShortcut;
}

/**
 * Two-view overlay: run list ⇄ run detail. Recreated from disk on every open
 * (overlay components are disposed on close); a JournalTailer follows the
 * selected live run and is stopped in dispose().
 */
class DashboardComponent {
  private runs: RunListing[] = [];
  private selected = 0;
  private view: "list" | "detail" = "list";
  private tailer: JournalTailer | null = null;
  private detailState: RunState | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly runRoot: string,
    private readonly requestRender: () => void,
    private readonly done: (result: void) => void,
  ) {
    this.reload();
    // The list view re-scans periodically so live runs move/update.
    this.refreshTimer = setInterval(() => {
      if (this.view === "list") {
        this.reload();
        this.requestRender();
      }
    }, 2000);
    this.refreshTimer.unref?.();
  }

  dispose(): void {
    this.stopTail();
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  invalidate(): void {}

  private reload(): void {
    const prev = this.runs[this.selected]?.runId;
    this.runs = listRuns(this.runRoot);
    if (prev) {
      const idx = this.runs.findIndex((r) => r.runId === prev);
      if (idx >= 0) this.selected = idx;
    }
    this.selected = Math.min(this.selected, Math.max(0, this.runs.length - 1));
  }

  private openDetail(): void {
    const run = this.runs[this.selected];
    if (!run) return;
    this.view = "detail";
    this.detailState = foldEvents(readJournalEvents(run.dir));
    if (run.live) {
      // Live: attach a fresh tailer folding from scratch so detail stays current.
      const state = newRunState();
      const tailer = new JournalTailer(run.dir, { pollMs: 1000 });
      tailer.on((events) => {
        for (const ev of events) reduceRun(state, ev);
        this.detailState = state;
        this.requestRender();
      });
      tailer.start();
      this.tailer = tailer;
    }
  }

  private stopTail(): void {
    this.tailer?.stop();
    this.tailer = null;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape")) {
      if (this.view === "detail") {
        this.stopTail();
        this.view = "list";
        this.requestRender();
      } else {
        this.done();
      }
      return;
    }
    if (this.view === "list") {
      if (matchesKey(data, "down") || data === "j") {
        this.selected = Math.min(this.selected + 1, Math.max(0, this.runs.length - 1));
      } else if (matchesKey(data, "up") || data === "k") {
        this.selected = Math.max(this.selected - 1, 0);
      } else if (matchesKey(data, "enter")) {
        this.openDetail();
      } else if (data === "q") {
        this.done();
      }
      this.requestRender();
    } else if (this.view === "detail") {
      if (data === "q") {
        this.stopTail();
        this.done();
      }
    }
  }

  render(width: number): string[] {
    return this.view === "list" ? this.renderList(width) : this.renderDetail(width);
  }

  private renderList(width: number): string[] {
    const lines: string[] = ["Sema workflow runs — ↑/↓ select · enter details · esc close", ""];
    if (this.runs.length === 0) {
      lines.push(`(no runs under ${this.runRoot})`);
      return lines.map((l) => clip(l, width));
    }
    this.runs.forEach((run, i) => {
      const cursor = i === this.selected ? "▸ " : "  ";
      const when = formatAge(Date.now() - run.mtimeMs);
      lines.push(`${cursor}${formatRunSummary(run.state)} · ${run.runId} · ${when}`);
    });
    return lines.map((l) => clip(l, width));
  }

  private renderDetail(width: number): string[] {
    const run = this.runs[this.selected];
    const state = this.detailState;
    if (!run || !state) return ["(no run selected)"];
    const lines = [
      `Run ${run.runId} — esc back · q close${run.live ? " · LIVE" : ""}`,
      "",
      ...formatRunLines(state, { maxAgents: 12 }),
    ];
    if (state.checkpoints.length > 0) {
      lines.push("", "Checkpoints:");
      for (const cp of state.checkpoints.slice(-8)) {
        lines.push(`  :${cp.key}${cp.value ? ` = ${clip(cp.value, 60)}` : ""}`);
      }
    }
    if (state.durMs != null) lines.push("", `Duration: ${formatMs(state.durMs)}`);
    const resultPath = join(run.dir, "result.json");
    if (!run.live && existsSync(resultPath)) {
      try {
        const value = JSON.parse(readFileSync(resultPath, "utf-8"));
        lines.push(`Result: ${clip(JSON.stringify(value), width - 10)}`);
      } catch {
        // unreadable result — journal view stands alone
      }
    }
    return lines.map((l) => clip(l, width));
  }
}

function clip(line: string, width: number): string {
  return line.length > width ? line.slice(0, Math.max(0, width - 1)) + "…" : line;
}

function formatAge(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
