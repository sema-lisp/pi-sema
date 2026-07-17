const DEFTOOL_CHEATSHEET = `
## deftool syntax (exact)

\`\`\`sema
(deftool tool-name
  "One-line description shown to callers"
  {:param-name {:type :string :description "what it is"}
   :other      {:type :number}}
  (lambda (param-name other)
    ...body, return value becomes the tool result...))
\`\`\`

Rules:
- Types: :string :number :boolean :list :map
- The lambda parameter order follows the params map order; names must match.
- Use the Sema stdlib (file/read, http/get, json/decode, shell, string/*, regex/*).
- Do NOT prefix the name with "_" and do NOT set :mcp/expose — both hide the tool.
- One deftool per submission. Helper (define …) forms before it are fine.
- The tool runs in a live long-running process: no (exit), no infinite loops.
`;

export function renderForgePrompt(description: string): string {
  return `The user wants a new reusable Sema tool forged:

> ${description.trim()}

Write the complete Sema source for ONE deftool that does this, then call the \`create_sema_tool\` tool with:
- name: a short kebab-case tool name
- description: one line
- source: the full source (helpers + the deftool form)

If create_sema_tool returns status "probe_failed", fix the reported error (it includes line/col/hint) and call it again with corrected source. Do not give up before 3 attempts.
${DEFTOOL_CHEATSHEET}`;
}

export const CREATE_TOOL_GUIDELINES = [
  "When a task needs a reusable capability that a short Sema script could provide (parsing, API calls, data transforms), forge it with create_sema_tool instead of repeating ad-hoc bash — the tool persists and becomes directly callable as sema_<name> on your next turn.",
  "If create_sema_tool reports probe_failed, correct the source using the error's line/col/hint and resubmit.",
];

export const CREATE_TOOL_DESCRIPTION = `Create a new persistent Sema tool from source. The source is verified in a strict sandbox (no LLM/network/shell/fs-write) with (tool? name) asserted, shown to the user for approval, stored in the tool library, injected into the live Sema environment, and registered as a pi tool named sema_<name> — callable from your NEXT turn (not this one).
${DEFTOOL_CHEATSHEET}`;
