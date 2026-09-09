import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractDefworkflowName,
  summarizeWorkflow,
  submitWorkflow,
} from "../src/workflows/author.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { LibraryStore } from "../src/library/store.js";
import type { PiSemaRuntime } from "../src/index.js";

describe("extractDefworkflowName", () => {
  it("extracts a single defworkflow name", () => {
    expect(
      extractDefworkflowName('(defworkflow research-pipe "d" {} (phase "A"))'),
    ).toBe("research-pipe");
  });
  it("rejects zero or multiple", () => {
    expect(extractDefworkflowName("(define x 1)")).toBeNull();
    expect(
      extractDefworkflowName('(defworkflow a "d" {})\n(defworkflow b "d" {})'),
    ).toBeNull();
  });
});

describe("summarizeWorkflow", () => {
  it("surfaces phases, budget, fan-out, steps and loads", () => {
    const source = `(load "/lib/agents/critic.sema")
(defworkflow content "d"
  {:phases ["Research" "Write"] :budget {:usd 2.0}}
  (phase "Research")
  (step "research" {:name "r"})
  (phase "Write")
  (parallel (map f xs) 8)
  (step "write" {:name "w"}))`;
    const lines = summarizeWorkflow(source).join("\n");
    expect(lines).toContain("Research → Write");
    expect(lines).toContain("{:usd 2.0}");
    expect(lines).toContain("LLM step leaves: 2");
    expect(lines).toContain("/lib/agents/critic.sema");
  });

  it("flags a missing budget loudly", () => {
    expect(
      summarizeWorkflow('(defworkflow x "d" {} (step "s" {}))').join("\n"),
    ).toContain("unbounded LLM spend");
  });
});

function semaAvailable(): boolean {
  try {
    execSync("sema --version", { stdio: "pipe", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!semaAvailable())(
  "submitWorkflow pipeline (live check)",
  () => {
    let cwd: string;
    let runtime: PiSemaRuntime;
    const confirms: boolean[] = [];

    const makeCtx = (hasUI: boolean, answers: boolean[]) => ({
      cwd,
      hasUI,
      ui: {
        confirm: async () => {
          confirms.push(true);
          return answers.shift() ?? false;
        },
      } as never,
    });

    beforeEach(() => {
      cwd = mkdtempSync(join(tmpdir(), "pi-sema-author-"));
      confirms.length = 0;
      runtime = {
        cfg: structuredClone(DEFAULT_CONFIG),
        store: new LibraryStore(cwd),
        bridge: null as never, // authoring never touches the bridge
      };
    });

    afterEach(() => {
      rmSync(cwd, { recursive: true, force: true });
    });

    const GOOD = `(defworkflow demo "d" {:phases ["A"]}
  (phase "A")
  (checkpoint :x 1)
  {:status :success :result (checkpoint :x)})`;

    it("checks, confirms twice (store + run), and stores to the project tier", async () => {
      const result = await submitWorkflow(
        runtime,
        makeCtx(true, [true, true]),
        { name: "demo", description: "demo wf", source: GOOD },
        new Map(),
      );
      const text =
        result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("status: stored");
      expect(text).toContain('call sema_workflow_run with workflow="demo"');
      expect(confirms).toHaveLength(2);

      const entry = runtime.store.resolve("workflows", "demo")!;
      expect(entry.tier).toBe("project");
      expect(readFileSync(entry.path, "utf-8")).toContain("defworkflow demo");
    }, 30_000);

    it("feeds check diagnostics back as check_failed rounds, then gives up", async () => {
      const bad = '(defworkflow bad "d" {:phases ["A"]} (phase "A" "extra"))';
      const rounds = new Map<string, number>();
      const p = { name: "bad", description: "d", source: bad };

      for (let round = 1; round < DEFAULT_CONFIG.forge.maxRounds; round++) {
        const result = await submitWorkflow(
          runtime,
          makeCtx(true, []),
          p,
          rounds,
        );
        const text =
          result.content[0].type === "text" ? result.content[0].text : "";
        expect(text).toContain(`check_failed (round ${round}`);
        expect(text).toContain("E-PHASE-ARITY");
      }
      const final = await submitWorkflow(runtime, makeCtx(true, []), p, rounds);
      const text =
        final.content[0].type === "text" ? final.content[0].text : "";
      expect(text).toContain("gave_up");
      expect(runtime.store.resolve("workflows", "bad")).toBeNull(); // nothing stored
    }, 60_000);

    it("declined at the store gate → nothing stored, model told not to resubmit", async () => {
      const result = await submitWorkflow(
        runtime,
        makeCtx(true, [false]),
        { name: "demo", description: "d", source: GOOD },
        new Map(),
      );
      const text =
        result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("declined");
      expect(runtime.store.resolve("workflows", "demo")).toBeNull();
    }, 30_000);

    it("rejects a submitted name that differs from the defworkflow name", async () => {
      const result = await submitWorkflow(
        runtime,
        makeCtx(false, []),
        { name: "stored-name", description: "d", source: GOOD },
        new Map(),
      );
      const text =
        result.content[0].type === "text" ? result.content[0].text : "";

      expect(text).toContain(
        'declared name "demo" does not match submitted name "stored-name"',
      );
      expect(runtime.store.resolve("workflows", "stored-name")).toBeNull();
    });

    it("keeps every description line inside comments in the stored source", async () => {
      const result = await submitWorkflow(
        runtime,
        makeCtx(false, []),
        {
          name: "demo",
          description: "first line\n(not-a-real-builtin)",
          source: GOOD,
        },
        new Map(),
      );
      const text =
        result.content[0].type === "text" ? result.content[0].text : "";
      const entry = runtime.store.resolve("workflows", "demo")!;
      const stored = readFileSync(entry.path, "utf-8");

      expect(text).toContain("status: stored");
      expect(stored).toContain("; first line\n; (not-a-real-builtin)");
      expect(stored).not.toContain("\n(not-a-real-builtin)");
    }, 30_000);
  },
);
