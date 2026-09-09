import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { hasSemaFiles, spawnSema } from "../src/sema.js";

describe("spawnSema", () => {
  it("does not start a process when its signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      spawnSema(["--version"], { signal: controller.signal }),
    ).resolves.toEqual({
      stdout: "",
      stderr: "",
      code: null,
      killed: true,
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe("hasSemaFiles", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "pi-sema-files-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("rescans a cwd after an initial negative result", () => {
    expect(hasSemaFiles(cwd)).toBe(false);
    writeFileSync(join(cwd, "new.sema"), "(+ 1 2)");
    expect(hasSemaFiles(cwd)).toBe(true);
  });
});
