# Workflow UI Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace pi-sema's raw workflow text drawing with safe, structured, bounded Pi TUI components and repair the remaining resource tests.

**Architecture:** Convert `RunState` to a serializable `WorkflowRunDetails` snapshot once per update, then render that snapshot independently in the tool row and live widget. Keep the dashboard stateful and scrollable, with a cache keyed by all journal segment metadata and a tailer only for the selected live run.

**Tech Stack:** TypeScript 7, Pi coding-agent/TUI 0.80.10, Vitest 4.

## Global Constraints

- Preserve all unrelated uncommitted user changes in the only worktree.
- Use `truncateToWidth` and `visibleWidth` for custom component rows.
- Emit at most five widget rows and one array item per terminal row.
- Do not commit, because the worktree contains pre-existing user changes.

---

### Task 1: Terminal-safe workflow presentation

**Files:**

- Create: `src/ui/text.ts`
- Create: `src/ui/workflow-view.ts`
- Modify: `src/ui/format.ts`
- Test: `test/ui-rendering.test.ts`

**Interfaces:**

- Produces: `sanitizeDisplayText(value: unknown): string`, `fitRow(value: string, width: number): string`, `toWorkflowRunDetails(state: RunState): WorkflowRunDetails`, and compact/expanded row presenters.
- Consumes: `RunState` from `src/workflows/model.ts` and Pi TUI width helpers.

- [ ] **Step 1: Write failing presentation tests**

```ts
expect(sanitizeDisplayText("a\n\u001b]52;c;secret\u0007b")).toBe("a b");
expect(formatRunSummary(finished)).toContain("Verify (2/2)");
expect(formatRunSummary(finished)).not.toContain("…");
expect(
  rows.every((row) => !row.includes("\n") && visibleWidth(row) <= 24),
).toBe(true);
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- test/ui-rendering.test.ts`

Expected: FAIL because the display helpers and structured snapshot do not exist and finished runs still use an ellipsis.

- [ ] **Step 3: Implement the minimal presentation layer**

```ts
export function fitRow(value: string, width: number): string {
  return truncateToWidth(value, Math.max(0, width), "…");
}

export function toWorkflowRunDetails(state: RunState): WorkflowRunDetails {
  return { ...state, agents: [...state.agents.values()].map(copyAgent) };
}
```

Strip OSC, CSI, C0, and C1 controls before collapsing whitespace. Render a terminal phase name for finished summaries.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- test/ui-rendering.test.ts`

Expected: PASS.

### Task 2: Structured tool renderer and mutable widget

**Files:**

- Create: `src/ui/workflow-tool.ts`
- Create: `src/ui/workflow-widget.ts`
- Modify: `src/workflows/runner.ts`
- Test: `test/workflow-ui.test.ts`

**Interfaces:**

- Produces: `renderWorkflowCall`, `renderWorkflowResult`, `WorkflowRunWidget`, and `WorkflowToolDetails`.
- Consumes: the serializable snapshot and compact/expanded presenters from Task 1.

- [ ] **Step 1: Write failing component tests**

```ts
const widget = new WorkflowRunWidget(tui, theme, details);
expect(widget.render(32)).toHaveLength(5);
expect(widget.render(32).every((row) => visibleWidth(row) <= 32)).toBe(true);
expect(toWorkflowRunDetails(state).agents).toEqual(expect.any(Array));
```

Assert partial tool results show the current phase, expanded results include every phase, and the execute path clears its unique widget key when `runWorkflow` throws.

- [ ] **Step 2: Verify RED**

Run: `npm test -- test/workflow-ui.test.ts`

Expected: FAIL because the components and render hooks do not exist.

- [ ] **Step 3: Implement structured renderers and lifecycle cleanup**

```ts
renderCall: renderWorkflowCall,
renderResult: renderWorkflowResult,
async execute(id, params, signal, onUpdate, ctx) {
  const widget = installWorkflowWidget(ctx, `sema-run-${id}`);
  try {
    return await executeWorkflow(onUpdate, widget);
  } finally {
    widget.clear();
  }
}
```

Reuse `context.lastComponent` for tool rows, mutate one widget component per call, and keep model-facing text concise.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- test/workflow-ui.test.ts`

Expected: PASS.

### Task 3: Cached, scrollable dashboard

**Files:**

- Modify: `src/ui/dashboard.ts`
- Test: `test/dashboard.test.ts`

**Interfaces:**

- Produces: `RunListingCache`, `listRuns(runRoot, cache)`, and exported `DashboardComponent` implementing Pi's component contract.
- Consumes: terminal-safe row helpers and `JournalTailer`.

- [ ] **Step 1: Write failing dashboard tests**

```ts
expect(
  component
    .render(30)
    .every((row) => visibleWidth(row) <= 30 && !row.includes("\n")),
).toBe(true);
component.handleInput("pageDown");
expect(component.render(30).at(-2)).toContain("of");
expect(listRuns(root, cache)[0].mtimeMs).toBe(resumeMtime);
```

Use a run with multiline/control-sequence checkpoint data, more rows than the viewport, and a resume journal ending the selected live run.

- [ ] **Step 2: Verify RED**

Run: `npm test -- test/dashboard.test.ts`

Expected: FAIL for unsafe rows, missing viewport behavior, stale liveness, or ignored resume metadata.

- [ ] **Step 3: Implement cache, viewport, and live transition**

```ts
const signature = segments
  .map(({ name, size, mtimeMs }) => `${name}:${size}:${mtimeMs}`)
  .join("|");
const body = rows.slice(scrollOffset, scrollOffset + bodyHeight);
if (state.status !== "live") {
  this.stopTail();
  run.live = false;
}
```

Reserve rows for themed border/title/footer chrome, keep selection visible, scroll detail rows, and load the result after the tailer observes a terminal event.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- test/dashboard.test.ts`

Expected: PASS.

### Task 4: Resource discovery and full verification

**Files:**

- Modify: `test/resources.test.ts`

**Interfaces:**

- Produces: validation that ignores non-directory skill entries and non-template prompt documentation.

- [ ] **Step 1: Use the existing failing resource tests as RED**

Run: `npm test -- test/resources.test.ts`

Expected: FAIL on `skills/.DS_Store` and `prompts/README.md`.

- [ ] **Step 2: Restrict discovery to executable resources**

```ts
const dirs = readdirSync(skills, { withFileTypes: true }).filter((entry) =>
  entry.isDirectory(),
);
const files = readdirSync(prompts).filter(
  (file) => file.endsWith(".md") && file !== "README.md",
);
```

- [ ] **Step 3: Verify GREEN and run the repository gates**

Run:

```sh
npm test -- test/resources.test.ts
npm test
npm run check
npm run build
git diff --check
```

Expected: every command exits 0. Review `git diff HEAD` before the final verification, fix any critical/high findings, and repeat the gates.
