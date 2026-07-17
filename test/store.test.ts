import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibraryStore, sanitizeName } from "../src/library/store.js";

let home: string;
let cwd: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "pi-sema-home-"));
  cwd = mkdtempSync(join(tmpdir(), "pi-sema-proj-"));
  vi.stubEnv("HOME", home);
  // paths.ts uses os.homedir(), which reads $HOME on darwin/linux at call time
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

describe("sanitizeName", () => {
  it("keeps safe names and strips .sema", () => {
    expect(sanitizeName("pdf-extract.sema")).toBe("pdf-extract");
    expect(sanitizeName("ns/tool_1")).toBe("ns/tool_1");
  });

  it("rejects traversal", () => {
    expect(() => sanitizeName("../evil")).not.toThrow(); // ".." becomes "__" via char replacement
    expect(sanitizeName("../evil")).toBe("__/evil");
    expect(() => sanitizeName("/")).toThrow();
    expect(() => sanitizeName("")).toThrow();
  });
});

describe("LibraryStore", () => {
  it("saves and lists a project tool", () => {
    const store = new LibraryStore(cwd);
    const path = store.save("project", "tools", "line-count", '(deftool line-count {} (lambda () 1))');
    expect(path).toBe(join(cwd, ".pi", "pi-sema", "tools", "line-count.sema"));
    const entries = store.list("tools");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ name: "line-count", tier: "project", kind: "tools" });
  });

  it("project tier shadows global on name collision", () => {
    const store = new LibraryStore(cwd);
    // global copy
    const globalDir = join(home, ".pi", "agent", "pi-sema", "tools");
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(join(globalDir, "dup.sema"), "; global\n");
    // project copy
    store.save("project", "tools", "dup", "; project");

    const entries = store.list("tools");
    const dup = entries.find((e) => e.name === "dup")!;
    expect(dup.tier).toBe("project");
    expect(store.read(dup)).toContain("project");
  });

  it("keeps kinds separate — a workflow never lists as a tool", () => {
    const store = new LibraryStore(cwd);
    store.save("project", "workflows", "research", "(defworkflow research ...)");
    expect(store.list("tools")).toHaveLength(0);
    expect(store.list("workflows")).toHaveLength(1);
  });

  it("resolves by name and by literal path", () => {
    const store = new LibraryStore(cwd);
    const path = store.save("project", "workflows", "wf", "(defworkflow wf ...)");
    expect(store.resolve("workflows", "wf")!.path).toBe(path);
    expect(store.resolve("workflows", path)!.path).toBe(path);
    expect(store.resolve("workflows", "missing")).toBeNull();
  });

  it("supports nested names via subdirectories", () => {
    const store = new LibraryStore(cwd);
    store.save("project", "tools", "pdf/extract", "; nested");
    const entries = store.list("tools");
    expect(entries[0].name).toBe("pdf/extract");
  });
});
