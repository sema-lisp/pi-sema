import { describe, expect, it } from "vitest";
import {
  registerToolResultErrorHook,
  toolError,
  toolText,
} from "../src/tool-result.js";

describe("registerToolResultErrorHook", () => {
  it("preserves toolError as a Pi tool error", () => {
    let handler:
      | ((event: {
          toolName: string;
          details: unknown;
        }) => { isError: true } | undefined)
      | undefined;
    const pi = {
      on: (_event: "tool_result", value: typeof handler) => {
        handler = value;
      },
    };

    registerToolResultErrorHook(pi as never);

    expect(
      handler?.({
        toolName: "sema_eval",
        details: toolError("failed").details,
      }),
    ).toEqual({ isError: true });
    expect(
      handler?.({
        toolName: "create_sema_tool",
        details: toolError("failed").details,
      }),
    ).toEqual({ isError: true });
  });

  it("does not alter successful or other-extension results", () => {
    let handler:
      | ((event: {
          toolName: string;
          details: unknown;
        }) => { isError: true } | undefined)
      | undefined;
    const pi = {
      on: (_event: "tool_result", value: typeof handler) => {
        handler = value;
      },
    };

    registerToolResultErrorHook(pi as never);

    expect(
      handler?.({ toolName: "sema_eval", details: toolText("ok").details }),
    ).toBeUndefined();
    expect(
      handler?.({
        toolName: "another_extension",
        details: toolError("failed").details,
      }),
    ).toBeUndefined();
  });
});
