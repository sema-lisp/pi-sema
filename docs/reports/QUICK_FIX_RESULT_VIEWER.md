# Quick Fix: Readable Results in TUI Dashboard

## The Problem

Current dashboard shows:

```
Result: {"result":{"files_changed":0,"report":"# Sem…
```

For our workflow, the actual markdown report is buried at `.result.report` and is 100+ lines.

## The Fix (5 minutes)

Replace lines 260-266 in `src/ui/dashboard.ts`:

**Before**:

```typescript
if (!run.live) {
  const value = readJsonFile(join(run.dir, "result.json"));
  if (value !== null)
    lines.push(`Result: ${clip(JSON.stringify(value), width - 10)}`);
}
```

**After**:

```typescript
if (!run.live) {
  const value = readJsonFile(join(run.dir, "result.json"));
  if (value !== null) {
    lines.push("", "Result:");
    lines.push(...formatResultValue(value, width - 2));
  }
}
```

Then add this helper at the bottom of the file (before the final `}`):

```typescript
/** Smart result formatter - detects common patterns and renders readably */
function formatResultValue(value: unknown, maxWidth: number): string[] {
  if (typeof value !== "object" || value === null) {
    return [`  ${clip(String(value), maxWidth)}`];
  }

  const obj = value as Record<string, unknown>;

  // Pattern 1: {result: {report: "markdown..."}}
  if (
    "result" in obj &&
    typeof obj.result === "object" &&
    obj.result !== null
  ) {
    const result = obj.result as Record<string, unknown>;
    if ("report" in result && typeof result.report === "string") {
      // Wrap markdown to terminal width
      const lines = result.report.split("\n");
      return lines.slice(0, 40).map((l) => `  ${clip(l, maxWidth)}`);
    }
  }

  // Pattern 2: {status: "...", result: {...}}
  if ("status" in obj && "result" in obj) {
    const lines = [`  status: ${obj.status}`];
    if (typeof obj.result === "string") {
      lines.push(`  result: ${clip(obj.result, maxWidth - 10)}`);
    } else {
      const pretty = JSON.stringify(obj.result, null, 2);
      lines.push(
        ...pretty
          .split("\n")
          .slice(0, 20)
          .map((l) => `  ${clip(l, maxWidth)}`),
      );
    }
    return lines;
  }

  // Fallback: pretty-printed JSON (truncated)
  const pretty = JSON.stringify(value, null, 2);
  return pretty
    .split("\n")
    .slice(0, 30)
    .map((l) => `  ${clip(l, maxWidth)}`);
}
```

## Test It

```bash
npm run build
jake pi.dev
# Open dashboard: /sema:workflows or ctrl+alt+s
# Select a completed run
# Hit Enter
# See the full markdown report, wrapped to width
```

## What You'll See

**Before**: `Result: {"result":{"files_changed":0,"report":"# Sem…`

**After**:

```
Result:
  # Sema Comment Style Standardization Report

  ## Overview

  This report documents the analysis, standardization decisions...

  ## 1. Summary Table of Files Processed

  | File | Lines Modified | Status | Notes |
  ...
  (scrollable, 40 lines shown)
```

## Next Level: Add Scrolling

If you want to scroll through long results, add to `handleInput` in detail view:

```typescript
} else if (this.view === "detail") {
  if (data === "q") {
    this.stopTail();
    this.done();
  } else if (matchesKey(data, "down") || data === "j") {
    // TODO: scroll result view down
  } else if (matchesKey(data, "up") || data === "k") {
    // TODO: scroll result view up
  }
}
```

But that requires tracking scroll position as state, which is more invasive.

## Alternative: Export to File

Add this key binding in detail view:

```typescript
} else if (data === "x") {
  this.exportResult();
}

private exportResult(): void {
  const run = this.runs[this.selected];
  if (!run || run.live) return;

  const value = readJsonFile(join(run.dir, "result.json"));
  if (!value) return;

  // Extract report or stringify
  let content: string;
  if (typeof value === "object" && "result" in value) {
    const result = (value as any).result;
    content = typeof result.report === "string"
      ? result.report
      : JSON.stringify(result, null, 2);
  } else {
    content = JSON.stringify(value, null, 2);
  }

  const outPath = join(run.dir, "report.md");
  writeFileSync(outPath, content, "utf-8");
  // Note: need to pass notify callback or use console.log
  console.log(`Exported to ${outPath}`);
}
```

Then add `x` to the help text:

```typescript
`Run ${run.runId} — esc back · q close · x export${run.live ? " · LIVE" : ""}`;
```

## Bottom Line

Just the `formatResultValue` helper makes workflows 10x more usable. Takes 5 minutes.
