import { Type, type Static } from "typebox";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { runSemaAsync } from "../sema.js";

export const semaCompileParams = Type.Object({
  file: Type.String({ description: "Path to the .sema file to compile to bytecode" }),
  output: Type.Optional(Type.String({ description: "Output .semac path (defaults to <file>.semac)" })),
});

export type SemaCompileParams = Static<typeof semaCompileParams>;

export async function semaCompileExecute(
  _toolCallId: string,
  params: SemaCompileParams,
  _signal: AbortSignal | undefined,
): Promise<AgentToolResult<any>> {
  const args = ["compile", params.file];
  if (params.output) args.push("-o", params.output);

  const result = await runSemaAsync(args, 60_000);

  if (result.exitCode !== 0) {
    return {
      content: [{ type: "text", text: result.stderr || result.stdout || `compile failed with exit code ${result.exitCode}` }],
      details: { isError: true, exitCode: result.exitCode },
    };
  }

  return {
    content: [{ type: "text", text: result.stdout || `Compiled ${params.file} to bytecode` }],
    details: {},
  };
}
