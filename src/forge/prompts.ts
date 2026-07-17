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
  "To UPDATE an existing tool, re-forge it with create_sema_tool — editing its .sema file on disk does NOT reload the live definition. A re-forge that changes the params map refreshes the schema too.",
  "Right after forging, you can exercise the tool in the SAME turn via sema_eval: (tool-name …args). The direct sema_<name> tool becomes callable next turn.",
];

export const CREATE_TOOL_DESCRIPTION = `Create a new persistent Sema tool from source. The source is verified in a strict sandbox (no LLM/network/shell/fs-write) with (tool? name) asserted, shown to the user for approval, stored in the tool library, injected into the live Sema environment, and registered as a pi tool named sema_<name> — callable from your NEXT turn (not this one).
${DEFTOOL_CHEATSHEET}`;

const DEFWORKFLOW_CHEATSHEET = `
## defworkflow syntax (exact)

\`\`\`sema
(defworkflow workflow-name
  "One-line description"
  {:phases ["Research" "Write" "Verify"]          ; declared plan, shown live
   :budget {:usd 2.0}}                            ; hard spend cap (sticky latch)
  (phase "Research")                              ; marker, exactly 1 arg — NOT a wrapper
  (checkpoint :topics (string/split (file/read "topics.txt") "\\n"))
  (phase "Write")
  (checkpoint :articles
    (parallel (map (lambda (t) (lambda ()
                     (step (f"write an article about \${t}") {:name "write"})))
                   (checkpoint :topics))
              8))                                 ; bounded fan-out, cap 8, order kept
  (phase "Verify")
  (step "fact-check the articles" {:name "verify"})
  {:status :success :result (checkpoint :articles)})
\`\`\`

Rules:
- \`(step prompt {:name … :schema … :tools […] :agent A})\` is the LLM leaf — journaled, memoized on resume.
  :schema → typed extraction; :tools → tool loop; :agent → run a defagent (its own tools/model).
- \`(checkpoint :k v)\` writes (value is the run's durable state), \`(checkpoint :k)\` reads back.
- \`(parallel thunks n)\` = barrier fan-out; \`(pipeline items stage…)\` = per-item flow, no barrier.
- Workflow args arrive from --args JSON bound to the global \`*workflow-args*\`; read with \`(:key *workflow-args*)\`.
- Stored defagents are NOT auto-loaded: \`(load "/path/to/agent.sema")\` them explicitly first.
- End the body with a \`{:status :success :result …}\` map (avoids the W-NO-STATUS warning).
- File/HTTP/shell stdlib is available; the run journals every step and is --resume-able.
`;

export function renderWorkflowPrompt(description: string): string {
  return `The user wants a new Sema WORKFLOW authored (workflows are separate from tools — journaled, resumable, budgeted multi-step LLM pipelines):

> ${description.trim()}

Write the complete Sema source for ONE defworkflow that does this, then call the \`submit_sema_workflow\` tool with:
- name: kebab-case workflow name
- description: one line
- source: the full source
- args: (optional) example args map this workflow expects

If submit_sema_workflow returns status "check_failed", fix the reported diagnostics (they include codes, line numbers and hints) and resubmit. After status "stored", if the result says the user approved running it, call \`sema_workflow_run\` with the stored name.
${DEFWORKFLOW_CHEATSHEET}`;
}

export const SUBMIT_WORKFLOW_DESCRIPTION = `Submit a complete (defworkflow …) source for validation and storage. It is statically checked (sema workflow check --strict, no LLM calls), previewed to the user for approval, and stored in the workflow library. It is NOT run by this tool — run it afterwards with sema_workflow_run when the result says the user approved.
${DEFWORKFLOW_CHEATSHEET}`;
