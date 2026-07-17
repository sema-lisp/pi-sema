import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { collectNamespacedSymbols, verifyToolSource } from "../src/forge/probe.js";

describe("collectNamespacedSymbols", () => {
  it("collects slash-namespaced symbols in call and value position", () => {
    const src = '(deftool t "d" {} (lambda (x) (string/join (file/read x) ", ")))';
    expect(collectNamespacedSymbols(src)).toEqual(["string/join", "file/read"]);
  });

  it("ignores strings, comments, keywords, and regex literals", () => {
    const src = [
      '; string/from-comment ignored',
      '(deftool t "call string/from-string-lit" {:mcp/expose #t}',
      '  (lambda () (regex/match? #"a/b" "x/y")))',
    ].join("\n");
    const symbols = collectNamespacedSymbols(src);
    expect(symbols).toContain("regex/match?");
    expect(symbols).not.toContain("string/from-comment");
    expect(symbols).not.toContain("string/from-string-lit");
    expect(symbols).not.toContain("mcp/expose");
    expect(symbols).not.toContain("a/b");
    expect(symbols).not.toContain("x/y");
  });

  it("dedupes repeated symbols", () => {
    expect(collectNamespacedSymbols("(string/trim (string/trim x))")).toEqual(["string/trim"]);
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

describe.skipIf(!semaAvailable())("probe catches call-time unbound stdlib symbols (live)", () => {
  it("rejects the exact session bug: string/concat inside the lambda body", async () => {
    // Sema resolves free vars at CALL time, so without forced resolution this
    // deftool would pass the probe and explode on first real use.
    const source = '(deftool bad-concat "d" {:s {:type :string}} (lambda (s) (string/concat "x " s)))';
    const result = await verifyToolSource(source, "bad-concat", { timeoutMs: 15_000 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("string/concat");
    }
  }, 20_000);

  it("still passes tools using real stdlib names", async () => {
    const source = '(deftool good-join "d" {:s {:type :string}} (lambda (s) (string/join (list "x" s) " ")))';
    const result = await verifyToolSource(source, "good-join", { timeoutMs: 15_000 });
    expect(result.ok).toBe(true);
  }, 20_000);
});
