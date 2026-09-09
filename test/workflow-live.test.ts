import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultRunRoot, runWorkflow } from "../src/workflows/runner.js";
import { workflowCheck } from "../src/workflows/check.js";
import type { RunState } from "../src/workflows/model.js";

function semaAvailable(): boolean {
  try {
    execSync("sema --version", { stdio: "pipe", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

const FIXTURE_WF = `(defworkflow fixture-run
  "No-LLM fixture workflow"
  {:phases ["Collect" "Process"]}
  (phase "Collect")
  (checkpoint :items [1 2 3])
  (phase "Process")
  (checkpoint :total (apply + (checkpoint :items)))
  {:status :success :result (checkpoint :total)})
`;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-sema-wf-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!semaAvailable())("workflow run + check (live sema)", () => {
  it("runs a no-LLM workflow end-to-end with live state updates", async () => {
    const file = join(dir, "fixture.sema");
    writeFileSync(file, FIXTURE_WF);
    const states: RunState[] = [];

    const outcome = await runWorkflow({
      file,
      args: {},
      runRoot: join(dir, "runs"),
      cwd: dir,
      onState: (s) =>
        states.push(structuredClone({ ...s, agents: undefined }) as never),
    });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.state.status).toBe("success");
    expect(outcome.state.phases.map((p) => p.status)).toEqual([
      "success",
      "success",
    ]);
    expect(
      outcome.state.checkpoints.find((c) => c.key === "total")?.value,
    ).toBe("6");
    expect(outcome.runId.startsWith("wfpi_")).toBe(true); // SEMA_WORKFLOW_RUN_ID pinning worked
    expect(states.length).toBeGreaterThan(0); // tailer streamed at least one batch
  }, 30_000);

  it("uses the session cwd for a configured relative run root", async () => {
    const file = join(dir, "relative-root.sema");
    writeFileSync(file, FIXTURE_WF);
    const runRoot = defaultRunRoot(dir, "relative-runs");

    const outcome = await runWorkflow({
      file,
      args: {},
      runRoot,
      cwd: dir,
    });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.state.status).toBe("success");
    expect(outcome.runDir.startsWith(join(dir, "relative-runs"))).toBe(true);
    expect(existsSync(join(outcome.runDir, "events.jsonl"))).toBe(true);
  }, 30_000);

  it("workflowCheck gates on error count, not exit code (warnings exit 1 under --strict)", async () => {
    const warnOnly = join(dir, "warn.sema");
    // no {:status …} tail → W-NO-STATUS warning but zero errors
    writeFileSync(
      warnOnly,
      '(defworkflow warn-wf "w" {:phases ["A"]} (phase "A") (checkpoint :x 1))\n',
    );
    const ok = await workflowCheck(warnOnly, { cwd: dir });
    expect(ok.ok).toBe(true);
    expect(ok.warnings.length).toBeGreaterThan(0);

    const broken = join(dir, "broken.sema");
    writeFileSync(
      broken,
      '(defworkflow bad-wf "b" {:phases ["A"]} (phase "A" "extra"))\n',
    );
    const bad = await workflowCheck(broken, { cwd: dir });
    expect(bad.ok).toBe(false);
    expect(bad.errors.some((e) => e.code === "E-PHASE-ARITY")).toBe(true);
  }, 30_000);

  it("reports a failed run with a resumable run id", async () => {
    const file = join(dir, "failing.sema");
    writeFileSync(
      file,
      '(defworkflow failing "f" {:phases ["A"]} (phase "A") (error "deliberate"))\n',
    );
    const outcome = await runWorkflow({
      file,
      args: {},
      runRoot: join(dir, "runs"),
      cwd: dir,
    });
    expect(outcome.state.status).toBe("failed");
    expect(outcome.exitCode).not.toBe(0);
  }, 30_000);
});
