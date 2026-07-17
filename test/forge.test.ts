import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { extractDeftoolName } from "../src/forge/forge.js";
import { verifyToolSource } from "../src/forge/probe.js";

describe("extractDeftoolName", () => {
  it("extracts the name from a single deftool", () => {
    expect(extractDeftoolName('(deftool line-count "d" {:p {:type :string}} (lambda (p) p))')).toBe("line-count");
  });

  it("allows helper defines before the deftool", () => {
    expect(extractDeftoolName('(define helper (lambda (x) x))\n(deftool my-tool "d" {} (lambda () (helper 1)))')).toBe(
      "my-tool",
    );
  });

  it("rejects zero or multiple deftools", () => {
    expect(extractDeftoolName("(define x 1)")).toBeNull();
    expect(extractDeftoolName('(deftool a "d" {} (lambda () 1))\n(deftool b "d" {} (lambda () 2))')).toBeNull();
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

describe.skipIf(!semaAvailable())("verifyToolSource (live sema)", () => {
  const TIMEOUT = { timeoutMs: 15_000 };

  it("passes a valid deftool", async () => {
    const result = await verifyToolSource(
      '(deftool doubler "Double" {:x {:type :number}} (lambda (x) (* x 2)))',
      "doubler",
      TIMEOUT,
    );
    expect(result.ok).toBe(true);
  }, 20_000);

  it("reports the nested error with line info for broken source", async () => {
    const result = await verifyToolSource(
      '(deftool broken "d" {:x {:type :number}} (lambda (x) (this-does-not-exist x)))\n(broken-paren',
      "broken",
      TIMEOUT,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message.length).toBeGreaterThan(0);
    }
  }, 20_000);

  it("fails when the deftool name does not match", async () => {
    const result = await verifyToolSource(
      '(deftool actual-name "d" {} (lambda () 1))',
      "expected-name",
      TIMEOUT,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // symbol reference to the missing name → unbound-symbol diagnostic
      expect(result.error.message.toLowerCase()).toMatch(/unbound|not a tool/);
    }
  }, 20_000);

  it("strict sandbox blocks shell access at load time", async () => {
    const result = await verifyToolSource(
      '(shell "sh" "-c" "echo pwned")\n(deftool sneaky "d" {} (lambda () 1))',
      "sneaky",
      TIMEOUT,
    );
    expect(result.ok).toBe(false);
  }, 20_000);

  it("enforces our timeout on load-time loops (sema --timeout is a no-op)", async () => {
    const result = await verifyToolSource(
      '(sleep 60000)\n(deftool slow "d" {} (lambda () 1))', // sleep takes milliseconds
      "slow",
      { timeoutMs: 1500 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("timed out");
    }
  }, 20_000);
});
