import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JournalTailer, readJournalEvents } from "../src/workflows/journal.js";
import type { JournalEvent } from "../src/workflows/model.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-sema-journal-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const line = (ev: object) => JSON.stringify(ev) + "\n";

describe("JournalTailer", () => {
  it("reads existing events and then only the appended delta", () => {
    writeFileSync(
      join(dir, "events.jsonl"),
      line({ event: "run.started", seq: 0, ts: "t" }) +
        line({ event: "phase.started", seq: 1, ts: "t", phase: "A" }),
    );
    const batches: JournalEvent[][] = [];
    const tailer = new JournalTailer(dir);
    tailer.on((b) => batches.push([...b]));

    tailer.drain();
    expect(batches.flat().map((e) => e.event)).toEqual([
      "run.started",
      "phase.started",
    ]);

    appendFileSync(
      join(dir, "events.jsonl"),
      line({
        event: "run.ended",
        seq: 2,
        ts: "t",
        status: "success",
        dur_ms: 1,
      }),
    );
    tailer.drain();
    expect(batches.flat().map((e) => e.event)).toEqual([
      "run.started",
      "phase.started",
      "run.ended",
    ]);
    tailer.stop();
  });

  it("buffers a partially-flushed trailing line until it completes", () => {
    const full = line({ event: "run.started", seq: 0, ts: "t" });
    writeFileSync(join(dir, "events.jsonl"), full + '{"event":"phase.st'); // torn write
    const events: JournalEvent[] = [];
    const tailer = new JournalTailer(dir);
    tailer.on((b) => events.push(...b));

    tailer.drain();
    expect(events).toHaveLength(1);

    appendFileSync(
      join(dir, "events.jsonl"),
      'arted","seq":1,"ts":"t","phase":"A"}\n',
    );
    tailer.drain();
    expect(events).toHaveLength(2);
    expect(events[1].event).toBe("phase.started");
    tailer.stop();
  });

  it("merges resume segments in numeric order after the base journal", () => {
    writeFileSync(
      join(dir, "events.jsonl"),
      line({ event: "run.started", seq: 0, ts: "t" }),
    );
    writeFileSync(
      join(dir, "events.resume-2.jsonl"),
      line({
        event: "run.ended",
        seq: 1,
        ts: "t",
        status: "success",
        dur_ms: 1,
      }),
    );
    writeFileSync(
      join(dir, "events.resume-1.jsonl"),
      line({ event: "run.started", seq: 0, ts: "t" }),
    );

    const events = readJournalEvents(dir);
    // base, then resume-1, then resume-2
    expect(events.map((e) => e.event)).toEqual([
      "run.started",
      "run.started",
      "run.ended",
    ]);
  });

  it("tolerates a run dir that does not exist yet", () => {
    const tailer = new JournalTailer(join(dir, "not-yet"));
    expect(() => tailer.drain()).not.toThrow();
    tailer.stop();

    // dir appears later → next drain picks it up
    mkdirSync(join(dir, "not-yet"));
    writeFileSync(
      join(dir, "not-yet", "events.jsonl"),
      line({ event: "run.started", seq: 0, ts: "t" }),
    );
    const events: JournalEvent[] = [];
    const tailer2 = new JournalTailer(join(dir, "not-yet"));
    tailer2.on((b) => events.push(...b));
    tailer2.drain();
    tailer2.stop();
    expect(events).toHaveLength(1);
  });

  it("skips malformed lines without derailing the stream", () => {
    writeFileSync(
      join(dir, "events.jsonl"),
      line({ event: "run.started", seq: 0, ts: "t" }) +
        "GARBAGE NOT JSON\n" +
        line({
          event: "run.ended",
          seq: 1,
          ts: "t",
          status: "success",
          dur_ms: 1,
        }),
    );
    const events = readJournalEvents(dir);
    expect(events.map((e) => e.event)).toEqual(["run.started", "run.ended"]);
  });
});
