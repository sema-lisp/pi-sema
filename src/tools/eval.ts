import { Type, type Static } from "typebox";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { runSemaAsync } from "../sema.js";

export const semaEvalParams = Type.Object({
  code: Type.Optional(Type.String({ description: "Sema expression to evaluate (inline via -e)" })),
  file: Type.Optional(Type.String({ description: "Path to a .sema file to run" })),
  args: Type.Optional(Type.Array(Type.String(), { description: "Arguments to pass to the script" })),
});

export type SemaEvalParams = Static<typeof semaEvalParams>;

export async function semaEvalExecute(
  _toolCallId: string,
  params: SemaEvalParams,
  _signal: AbortSignal | undefined,
): Promise<AgentToolResult<any>> {
  if (!params.code && !params.file) {
    return { content: [{ type: "text", text: "Either `code` or `file` is required." }], details: { isError: true } };
  }

  const args: string[] = [];
  if (params.code) {
    args.push("-e", params.code);
  } else if (params.file) {
    args.push(params.file);
    if (params.args) args.push(...params.args);
  }

  const result = await runSemaAsync(args, 60_000);

  if (result.exitCode !== 0) {
    return {
      content: [{ type: "text", text: result.stderr || result.stdout || `Exit code: ${result.exitCode}` }],
      details: { isError: true, exitCode: result.exitCode },
    };
  }

  return {
    content: [{ type: "text", text: result.stdout || "(no output)" }],
    details: {},
  };
}
