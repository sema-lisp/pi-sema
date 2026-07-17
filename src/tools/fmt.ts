import { Type, type Static } from "typebox";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { runSemaAsync } from "../sema.js";

export const semaFmtParams = Type.Object({
  path: Type.String({ description: "Path to the .sema file to format" }),
  check: Type.Optional(Type.Boolean({ description: "Check mode — report whether formatting differs without modifying" })),
});

export type SemaFmtParams = Static<typeof semaFmtParams>;

export async function semaFmtExecute(
  _toolCallId: string,
  params: SemaFmtParams,
  _signal: AbortSignal | undefined,
): Promise<AgentToolResult<any>> {
  const args = ["fmt"];
  if (params.check) args.push("--check");
  args.push(params.path);

  const result = await runSemaAsync(args);

  if (result.exitCode !== 0) {
    return {
      content: [{ type: "text", text: result.stderr || result.stdout || `fmt failed with exit code ${result.exitCode}` }],
      details: { isError: true, exitCode: result.exitCode },
    };
  }

  const summary = params.check
    ? `Format check passed for ${params.path}`
    : `Formatted ${params.path}`;

  return {
    content: [{ type: "text", text: result.stdout || summary }],
    details: {},
  };
}
