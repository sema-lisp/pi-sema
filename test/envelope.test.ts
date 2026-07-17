import { describe, it, expect } from "vitest";
import { parseEnvelope, formatSemaError } from "../src/envelope.js";

describe("parseEnvelope", () => {
  it("parses a success envelope", () => {
    const env = parseEnvelope(
      '{"ok":true,"value":"3","stdout":"","stderr":"","elapsedMs":1}',
    );
    expect(env).not.toBeNull();
    expect(env!.ok).toBe(true);
    expect(env!.value).toBe("3");
  });

  it("parses the nested error object (not flat error_* fields)", () => {
    const env = parseEnvelope(
      '{"ok":false,"error":{"message":"unbound symbol: nope","hint":"did you mean note?","line":2,"col":4}}',
    );
    expect(env!.ok).toBe(false);
    expect(env!.error!.message).toContain("unbound");
    expect(env!.error!.line).toBe(2);
    expect(env!.error!.col).toBe(4);
  });

  it("tolerates leading program output before the JSON line", () => {
    const env = parseEnvelope('hello from print\n{"ok":true,"value":"nil"}');
    expect(env!.ok).toBe(true);
  });

  it("returns null for garbage", () => {
    expect(parseEnvelope("")).toBeNull();
    expect(parseEnvelope("not json at all")).toBeNull();
    expect(parseEnvelope('{"no_ok_field":1}')).toBeNull();
  });
});

describe("formatSemaError", () => {
  it("includes location and hint", () => {
    const msg = formatSemaError({
      message: "boom",
      hint: "try x",
      line: 3,
      col: 7,
    });
    expect(msg).toBe("boom (line 3:7)\nhint: try x");
  });

  it("falls back when absent", () => {
    expect(formatSemaError(undefined, "fallback")).toBe("fallback");
  });
});
