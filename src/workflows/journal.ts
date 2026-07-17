import {
  openSync,
  readSync,
  closeSync,
  statSync,
  readdirSync,
  watch,
  type FSWatcher,
} from "node:fs";
import { join } from "node:path";
import type { JournalEvent } from "./model.js";

/**
 * Incremental tailer for a run directory's journal:
 * events.jsonl + events.resume-N.jsonl segments, ordered base → resume-1 → ….
 *
 * The journal contract (journal.rs): one JSON line per event, flushed
 * immediately; a crash leaves a valid JSONL prefix. So byte-offset tailing
 * with a line buffer is safe on live runs. fs.watch is best-effort — a poll
 * interval (default 1s, matching the official viewer) is the reliable path.
 */
export class JournalTailer {
  private offsets = new Map<string, number>();
  private partial = new Map<string, string>();
  private listeners = new Set<(events: JournalEvent[]) => void>();
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private draining = false;
  private pendingDrain = false;
  private stopped = false;

  constructor(
    private readonly runDir: string,
    private readonly opts: { pollMs?: number } = {},
  ) {}

  on(cb: (events: JournalEvent[]) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  start(): void {
    this.stopped = false;
    // The run dir may not exist yet (child just spawned) — watch is attached
    // lazily from the drain loop; polling carries us until then.
    this.timer = setInterval(() => this.drain(), this.opts.pollMs ?? 1000);
    this.timer.unref?.();
    this.drain();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.watcher?.close();
    this.watcher = null;
  }

  /** Read everything new across all segments; re-entrancy-guarded. */
  drain(): void {
    if (this.stopped) return;
    if (this.draining) {
      this.pendingDrain = true;
      return;
    }
    this.draining = true;
    try {
      this.attachWatcher();
      const batch: JournalEvent[] = [];
      for (const file of this.segmentFiles()) {
        this.readNew(file, batch);
      }
      if (batch.length > 0) {
        for (const listener of this.listeners) listener(batch);
      }
    } finally {
      this.draining = false;
      if (this.pendingDrain) {
        this.pendingDrain = false;
        this.drain();
      }
    }
  }

  /** Segment order: base journal first, then resume segments numerically. */
  private segmentFiles(): string[] {
    let names: string[];
    try {
      names = readdirSync(this.runDir);
    } catch {
      return [];
    }
    const resumes = names
      .map((n) => /^events\.resume-(\d+)\.jsonl$/.exec(n))
      .filter((m): m is RegExpExecArray => m !== null)
      .sort((a, b) => Number(a[1]) - Number(b[1]))
      .map((m) => m[0]);
    const ordered = names.includes("events.jsonl")
      ? ["events.jsonl", ...resumes]
      : resumes;
    return ordered.map((n) => join(this.runDir, n));
  }

  private attachWatcher(): void {
    if (this.watcher || this.stopped) return;
    try {
      statSync(this.runDir);
      this.watcher = watch(this.runDir, () => this.drain());
      this.watcher.unref?.();
    } catch {
      // dir not created yet — poll fallback keeps trying
    }
  }

  private readNew(file: string, into: JournalEvent[]): void {
    let size: number;
    try {
      size = statSync(file).size;
    } catch {
      return;
    }
    const offset = this.offsets.get(file) ?? 0;
    if (size <= offset) return;

    let fd: number;
    try {
      fd = openSync(file, "r");
    } catch {
      return;
    }
    try {
      const length = size - offset;
      const buffer = Buffer.alloc(length);
      const read = readSync(fd, buffer, 0, length, offset);
      this.offsets.set(file, offset + read);
      const text =
        (this.partial.get(file) ?? "") + buffer.toString("utf-8", 0, read);
      const lines = text.split("\n");
      this.partial.set(file, lines.pop() ?? ""); // keep incomplete tail for the next drain
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed.event === "string")
            into.push(parsed as JournalEvent);
        } catch {
          // malformed line (should not happen given the flush contract) — skip
        }
      }
    } finally {
      closeSync(fd);
    }
  }
}

/** One-shot fold helper for finished runs (dashboard historical view). */
export function readJournalEvents(runDir: string): JournalEvent[] {
  const events: JournalEvent[] = [];
  const tailer = new JournalTailer(runDir);
  tailer.on((batch) => events.push(...batch));
  tailer.drain();
  tailer.stop();
  return events;
}
