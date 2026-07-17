import { Type, type Static } from "typebox";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { runSemaAsync } from "../sema.js";

export const semaBuildParams = Type.Object({
  file: Type.String({ description: "Path to the .sema file to build" }),
  output: Type.Optional(Type.String({ description: "Output binary path (defaults to the file stem)" })),
  args: Type.Optional(Type.Array(Type.String(), { description: "Extra arguments to pass to sema build" })),
});

export type SemaBuildParams = Static<typeof semaBuildParams>;

export async function semaBuildExecute(
  _toolCallId: string,
  params: SemaBuildParams,
  _signal: AbortSignal | undefined,
): Promise<AgentToolResult<any>> {
  const args = ["build", params.file];
  if (params.output) args.push("-o", params.output);
  if (params.args) args.push(...params.args);

  const result = await runSemaAsync(args, 120_000);

  if (result.exitCode !== 0) {
    return {
      content: [{ type: "text", text: result.stderr || result.stdout || `build failed with exit code ${result.exitCode}` }],
      details: { isError: true, exitCode: result.exitCode },
    };
  }

  return {
    content: [{ type: "text", text: result.stdout || `Built ${params.file}${params.output ? ` → ${params.output}` : ""}` }],
    details: {},
  };
}
