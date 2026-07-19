/**
 * The workflow dashboard — a TUI overlay listing runs and their live status.
 *
 * WHAT: registers /sema:workflows + a shortcut, and the two-view (list ⇄
 * detail) overlay component that reads runs from the run root on disk.
 *
 * HOW/WHY: historical runs are folded once from their journal; a JournalTailer
 * follows only the selected live run and is stopped on close. The overlay is
 * rebuilt from disk on every open because pi disposes overlay components when
 * they close, so there is no long-lived state to keep in sync.
 */
import { readdirSync, statSync, type Dirent } from "node:fs";
import { join } from "node:path";
import {
  matchesKey,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { PiSemaRuntime } from "../index.js";
import { readJsonFile } from "../util.js";
import { JournalTailer, readJournalEvents } from "../workflows/journal.js";
import {
  foldEvents,
  newRunState,
  reduceRun,
  type JournalEvent,
  type RunState,
} from "../workflows/model.js";
import { formatRunLines, formatRunSummary, formatMs } from "./format.js";
import { defaultRunRoot } from "../workflows/runner.js";
import { DEFAULT_CONFIG } from "../config.js";
import { fitRow, sanitizeDisplayText } from "./text.js";

export interface RunListing {
  runId: string;
  dir: string;
  mtimeMs: number;
  state: RunState;
  live: boolean;
}

interface CachedRunListing {
  signature: string;
  listing: RunListing;
}

export type RunListingCache = Map<string, CachedRunListing>;

/** Scan the run root the same way GET /api/runs does: dirs with a journal, newest first. */
export function listRuns(
  runRoot: string,
  cache: RunListingCache = new Map(),
): RunListing[] {
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(runRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const runs: RunListing[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(runRoot, entry.name);
    try {
      const segments = journalSegmentStats(dir);
      if (!segments.some((segment) => segment.name === "events.jsonl")) {
        continue;
      }
      const signature = segments
        .map((segment) => `${segment.name}:${segment.size}:${segment.mtimeMs}`)
        .join("|");
      const cacheKey = dir;
      seen.add(cacheKey);
      const cached = cache.get(cacheKey);
      if (cached?.signature === signature) {
        runs.push(cached.listing);
        continue;
      }
      const state = foldEvents(readJournalEvents(dir));
      const listing: RunListing = {
        runId: entry.name,
        dir,
        mtimeMs: Math.max(...segments.map((segment) => segment.mtimeMs)),
        state,
        live: state.status === "live",
      };
      cache.set(cacheKey, { signature, listing });
      runs.push(listing);
    } catch {
      // not a run dir
    }
  }
  for (const key of cache.keys()) {
    if (key.startsWith(`${runRoot}/`) && !seen.has(key)) cache.delete(key);
  }
  return runs.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function journalSegmentStats(dir: string): {
  name: string;
  size: number;
  mtimeMs: number;
}[] {
  const names = readdirSync(dir)
    .filter(
      (name) =>
        name === "events.jsonl" || /^events\.resume-\d+\.jsonl$/.test(name),
    )
    .sort((a, b) => segmentOrder(a) - segmentOrder(b));
  return names.map((name) => {
    const stat = statSync(join(dir, name));
    return { name, size: stat.size, mtimeMs: stat.mtimeMs };
  });
}

function segmentOrder(name: string): number {
  if (name === "events.jsonl") return 0;
  return Number(/^events\.resume-(\d+)\.jsonl$/.exec(name)?.[1] ?? 0) + 1;
}

export function registerDashboard(
  pi: ExtensionAPI,
  getRuntime: () => PiSemaRuntime | null,
): void {
  const open = async (ctx: ExtensionContext) => {
    if (ctx.mode !== "tui") {
      ctx.ui.notify(
        "The workflow dashboard needs the TUI. Runs live in .sema/runs/ — inspect with `sema workflow view`.",
        "warning",
      );
      return;
    }
    const runtime = getRuntime();
    const runRoot = defaultRunRoot(
      ctx.cwd,
      runtime?.cfg.workflows.runDir ?? null,
    );
    await ctx.ui.custom<void>(
      (tui, theme, _keybindings, done) =>
        new DashboardComponent(runRoot, {
          requestRender: () => tui.requestRender(),
          done,
          theme,
          maxHeight: () => Math.max(6, Math.floor(tui.terminal.rows * 0.7)),
        }),
      {
        overlay: true,
        overlayOptions: { anchor: "center", width: "80%", maxHeight: "70%" },
      },
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
  const parsed = readJsonFile<{ ui?: { dashboardShortcut?: unknown } }>(
    join(process.env.HOME ?? "", ".pi", "agent", "pi-sema", "config.json"),
  );
  const shortcut = parsed?.ui?.dashboardShortcut;
  return typeof shortcut === "string"
    ? shortcut
    : DEFAULT_CONFIG.ui.dashboardShortcut;
}

/**
 * Two-view overlay: run list ⇄ run detail. Recreated from disk on every open
 * (overlay components are disposed on close); a JournalTailer follows the
 * selected live run and is stopped in dispose().
 */
export interface DashboardTailer {
  start(): void;
  stop(): void;
}

export interface DashboardOptions {
  requestRender(): void;
  done(): void;
  theme: Theme;
  maxHeight(): number;
  refreshMs?: number | false;
  now?: () => number;
  tailerFactory?: (
    onEvents: (events: JournalEvent[]) => void,
    runDir: string,
  ) => DashboardTailer;
}

interface DashboardRow {
  text: string;
  selected?: boolean;
}

export class DashboardComponent implements Component {
  private runs: RunListing[] = [];
  private selected = 0;
  private view: "list" | "detail" = "list";
  private tailer: DashboardTailer | null = null;
  private detailState: RunState | null = null;
  private detailResult: unknown | undefined;
  private refreshTimer: NodeJS.Timeout | null = null;
  private readonly runCache: RunListingCache = new Map();
  private listOffset = 0;
  private detailOffset = 0;
  private detailFollow = false;
  private detailRowCount = 0;
  private lastBodyHeight = 1;

  constructor(
    private readonly runRoot: string,
    private readonly options: DashboardOptions,
  ) {
    this.reload();
    const refreshMs =
      options.refreshMs === undefined ? 2000 : options.refreshMs;
    if (refreshMs !== false) {
      this.refreshTimer = setInterval(() => {
        if (this.view === "list") {
          this.reload();
          this.options.requestRender();
        } else if (
          this.detailState?.status !== "live" &&
          this.detailResult === undefined
        ) {
          const run = this.runs[this.selected];
          if (run && this.loadDetailResult(run)) {
            this.options.requestRender();
          }
        }
      }, refreshMs);
      this.refreshTimer.unref?.();
    }
  }

  dispose(): void {
    this.stopTail();
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  invalidate(): void {}

  private reload(): void {
    const prev = this.runs[this.selected]?.runId;
    this.runs = listRuns(this.runRoot, this.runCache);
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
    run.state = this.detailState;
    run.live = this.detailState.status === "live";
    this.detailResult = undefined;
    if (!run.live) this.loadDetailResult(run);
    this.detailOffset = 0;
    this.detailFollow = run.live;
    if (run.live) {
      // Live: attach a fresh tailer folding from scratch so detail stays current.
      const state = newRunState();
      const onEvents = (events: JournalEvent[]) => {
        for (const ev of events) reduceRun(state, ev);
        this.detailState = state;
        run.state = state;
        run.live = state.status === "live";
        if (!run.live) {
          this.loadDetailResult(run);
          this.detailFollow = true;
          this.stopTail();
        }
        this.options.requestRender();
      };
      const tailer = this.options.tailerFactory
        ? this.options.tailerFactory(onEvents, run.dir)
        : createJournalTailer(run.dir, onEvents);
      this.tailer = tailer;
      tailer.start();
    }
  }

  private stopTail(): void {
    const tailer = this.tailer;
    this.tailer = null;
    tailer?.stop();
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape")) {
      if (this.view === "detail") {
        this.stopTail();
        this.view = "list";
        this.reload();
        this.options.requestRender();
      } else {
        this.options.done();
      }
      return;
    }
    if (this.view === "list") {
      if (matchesKey(data, "down") || data === "j") {
        this.selected = Math.min(
          this.selected + 1,
          Math.max(0, this.runs.length - 1),
        );
      } else if (matchesKey(data, "up") || data === "k") {
        this.selected = Math.max(this.selected - 1, 0);
      } else if (matchesKey(data, "enter")) {
        this.openDetail();
      } else if (data === "q") {
        this.options.done();
      }
      this.options.requestRender();
    } else if (this.view === "detail") {
      if (data === "q") {
        this.stopTail();
        this.options.done();
        return;
      }
      if (data === "G" || matchesKey(data, "end")) {
        this.detailFollow = true;
      } else if (data === "g" || matchesKey(data, "home")) {
        this.detailFollow = false;
        this.detailOffset = 0;
      } else if (matchesKey(data, "down") || data === "j") {
        this.detailFollow = false;
        this.detailOffset = Math.min(
          this.detailOffset + 1,
          this.maxDetailOffset(),
        );
      } else if (matchesKey(data, "up") || data === "k") {
        this.detailFollow = false;
        this.detailOffset = Math.max(0, this.detailOffset - 1);
      } else if (matchesKey(data, "pageDown")) {
        this.detailFollow = false;
        this.detailOffset = Math.min(
          this.detailOffset + this.lastBodyHeight,
          this.maxDetailOffset(),
        );
      } else if (matchesKey(data, "pageUp")) {
        this.detailFollow = false;
        this.detailOffset = Math.max(
          0,
          this.detailOffset - this.lastBodyHeight,
        );
      }
      this.options.requestRender();
    }
  }

  render(width: number): string[] {
    return this.view === "list"
      ? this.renderList(width)
      : this.renderDetail(width);
  }

  private renderList(width: number): string[] {
    const bodyHeight = this.bodyHeight();
    this.lastBodyHeight = bodyHeight;
    if (this.selected < this.listOffset) this.listOffset = this.selected;
    if (this.selected >= this.listOffset + bodyHeight) {
      this.listOffset = this.selected - bodyHeight + 1;
    }
    const visible = this.runs.slice(
      this.listOffset,
      this.listOffset + bodyHeight,
    );
    const rows: DashboardRow[] =
      visible.length === 0
        ? [
            {
              text: `(no runs under ${sanitizeDisplayText(this.runRoot)})`,
            },
          ]
        : visible.map((run, index) => {
            const absolute = this.listOffset + index;
            const cursor = absolute === this.selected ? "▸ " : "  ";
            const when = formatAge(
              (this.options.now?.() ?? Date.now()) - run.mtimeMs,
            );
            return {
              text: `${cursor}${formatRunSummary(run.state)} · ${sanitizeDisplayText(run.runId)} · ${when}`,
              selected: absolute === this.selected,
            };
          });
    const start = this.runs.length === 0 ? 0 : this.listOffset + 1;
    const end = Math.min(this.listOffset + visible.length, this.runs.length);
    return this.frame(
      `Sema workflow runs (${this.runs.length})`,
      rows,
      `${start}-${end} of ${this.runs.length} · ↑/↓ select · enter details · esc close`,
      width,
      bodyHeight,
    );
  }

  private renderDetail(width: number): string[] {
    const run = this.runs[this.selected];
    const state = this.detailState;
    if (!run || !state) return [fitRow("(no run selected)", width)];
    const bodyHeight = this.bodyHeight();
    this.lastBodyHeight = bodyHeight;
    const lines = formatRunLines(state, { maxAgents: 12 });
    if (state.checkpoints.length > 0) {
      lines.push("", "Checkpoints:");
      for (const cp of state.checkpoints.slice(-8)) {
        const key = sanitizeDisplayText(cp.key);
        const value = sanitizeDisplayText(cp.value);
        lines.push(`  :${key}${value ? ` = ${value}` : ""}`);
      }
    }
    if (state.durMs != null)
      lines.push("", `Duration: ${formatMs(state.durMs)}`);
    if (state.status !== "live" && this.detailResult !== undefined) {
      const value = JSON.stringify(this.detailResult);
      if (value !== undefined) {
        lines.push(`Result: ${sanitizeDisplayText(value)}`);
      }
    }
    this.detailRowCount = lines.length;
    if (this.detailFollow) this.detailOffset = this.maxDetailOffset();
    else
      this.detailOffset = Math.min(this.detailOffset, this.maxDetailOffset());
    const visible = lines
      .slice(this.detailOffset, this.detailOffset + bodyHeight)
      .map((text) => ({ text }));
    const start = lines.length === 0 ? 0 : this.detailOffset + 1;
    const end = Math.min(this.detailOffset + visible.length, lines.length);
    return this.frame(
      `Run ${sanitizeDisplayText(run.runId)}${state.status === "live" ? " · LIVE" : ` · ${state.status}`}`,
      visible,
      `${start}-${end} of ${lines.length} · ↑/↓ scroll · PgUp/PgDn · esc back`,
      width,
      bodyHeight,
    );
  }

  private bodyHeight(): number {
    return Math.max(1, Math.floor(this.options.maxHeight()) - 3);
  }

  private maxDetailOffset(): number {
    return Math.max(0, this.detailRowCount - this.lastBodyHeight);
  }

  private loadDetailResult(run: RunListing): boolean {
    const value = readJsonFile(join(run.dir, "result.json"));
    if (value === null) return false;
    this.detailResult = value;
    return true;
  }

  private frame(
    title: string,
    rows: DashboardRow[],
    footer: string,
    width: number,
    bodyHeight: number,
  ): string[] {
    if (width < 4) return [fitRow(sanitizeDisplayText(title), width)];
    const innerWidth = width - 2;
    const cleanTitle = fitRow(` ${sanitizeDisplayText(title)} `, innerWidth);
    const titleFill = "─".repeat(
      Math.max(0, innerWidth - visibleWidth(cleanTitle)),
    );
    const top = this.options.theme.fg(
      "borderAccent",
      `╭${cleanTitle}${titleFill}╮`,
    );
    const body = rows.slice(0, bodyHeight).map((row) => {
      const fitted = fitRow(row.text, innerWidth, true);
      const styled = row.selected
        ? this.options.theme.bg(
            "selectedBg",
            this.options.theme.fg("text", fitted),
          )
        : this.options.theme.fg("text", fitted);
      return `${this.options.theme.fg("border", "│")}${styled}${this.options.theme.fg("border", "│")}`;
    });
    while (body.length < bodyHeight) {
      body.push(
        `${this.options.theme.fg("border", "│")}${" ".repeat(innerWidth)}${this.options.theme.fg("border", "│")}`,
      );
    }
    const footerText = this.options.theme.fg(
      "muted",
      fitRow(sanitizeDisplayText(footer), innerWidth, true),
    );
    const footerRow = `${this.options.theme.fg("border", "│")}${footerText}${this.options.theme.fg("border", "│")}`;
    const bottom = this.options.theme.fg(
      "borderAccent",
      `╰${"─".repeat(innerWidth)}╯`,
    );
    return [top, ...body, footerRow, bottom].map((line) => fitRow(line, width));
  }
}

function createJournalTailer(
  runDir: string,
  onEvents: (events: JournalEvent[]) => void,
): DashboardTailer {
  const tailer = new JournalTailer(runDir, { pollMs: 1000 });
  tailer.on(onEvents);
  return tailer;
}

function formatAge(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
