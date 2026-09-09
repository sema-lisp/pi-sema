import { describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { spawnSema } from "../src/sema.js";

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
