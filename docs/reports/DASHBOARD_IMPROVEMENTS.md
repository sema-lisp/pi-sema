# Dashboard UI Improvements — Prioritized

## Current State

The dashboard (`src/ui/dashboard.ts`) works but has poor ergonomics:

1. **Result display is unusable**

   ```typescript
   // Current: line 263
   lines.push(`Result: ${clip(JSON.stringify(value), width - 10)}`);
   ```

   This shows: `Result: {"result":{"files_changed":0,"report":"# Sem…`

   For our workflow, the actual report is at `.result.report` and is 100+ lines of markdown.

2. **Checkpoints truncated at 60 chars**

   ```typescript
   // Current: line 257
   lines.push(`  :${cp.key}${cp.value ? ` = ${clip(cp.value, 60)}` : ""}`);
   ```

   Can't see arrays, objects, or long strings.

3. **No way to copy/export results**
   Must use CLI: `cat .sema/runs/<id>/result.json | jq ...`

4. **No re-run capability**
   Want to run same workflow with different args? Edit source or use CLI.

## Quick Wins (Ranked by Impact/Effort)

### 1. **Smart Result Rendering** ⭐ HIGHEST IMPACT

**Effort**: 30 minutes
**Impact**: Makes workflows actually usable

Add to `renderDetail()`:

```typescript
// After line 263, replace the single-line Result with:
if (!run.live) {
  const value = readJsonFile(join(run.dir, "result.json"));
  if (value !== null) {
    lines.push("", "Result:");
    lines.push(...formatResult(value, width - 2));
  }
}

function formatResult(value: unknown, maxWidth: number): string[] {
  // Detect common patterns
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;

    // Pattern: {result: {report: "markdown..."}}
    if ("result" in obj && typeof obj.result === "object") {
      const result = obj.result as Record<string, unknown>;
      if ("report" in result && typeof result.report === "string") {
        // Show the markdown report, wrapped to width
        return wrapText(result.report, maxWidth);
      }
    }

    // Pattern: {status, result: <data>}
    if ("status" in obj && "result" in obj) {
      return [
        `  status: ${obj.status}`,
        `  result: ${formatValue(obj.result, maxWidth - 4)}`,
      ];
    }
  }

  // Fallback: pretty JSON
  return JSON.stringify(value, null, 2)
    .split("\n")
    .slice(0, 50) // Cap at 50 lines
    .map((l) => `  ${clip(l, maxWidth)}`);
}
```

### 2. **Expandable Checkpoints**

**Effort**: 45 minutes
**Impact**: Medium - debugging workflows

Add key bindings in detail view:

- `c` → toggle checkpoint view (collapsed/expanded)
- When expanded, show full JSON pretty-printed

```typescript
private checkpointExpanded = false;

// In handleInput, detail view:
} else if (data === "c") {
  this.checkpointExpanded = !this.checkpointExpanded;
  this.requestRender();
}

// In renderDetail:
if (state.checkpoints.length > 0) {
  lines.push("", `Checkpoints (${this.checkpointExpanded ? "c to collapse" : "c to expand"}):`);
  if (this.checkpointExpanded) {
    for (const cp of state.checkpoints.slice(-8)) {
      lines.push(`  :${cp.key}`);
      if (cp.value) {
        const formatted = JSON.stringify(JSON.parse(cp.value), null, 2);
        formatted.split("\n").forEach(l => lines.push(`    ${l}`));
      }
    }
  } else {
    for (const cp of state.checkpoints.slice(-8)) {
      lines.push(`  :${cp.key}${cp.value ? ` = ${clip(cp.value, 60)}` : ""}`);
    }
  }
}
```

### 3. **Export Result Button**

**Effort**: 30 minutes
**Impact**: Medium - sharing results

Add key binding: `x` → export result to clipboard (if available) or save to file

```typescript
} else if (data === "x") {
  this.exportResult();
  this.requestRender();
}

private exportResult(): void {
  const run = this.runs[this.selected];
  if (!run || run.live) return;

  const value = readJsonFile(join(run.dir, "result.json"));
  if (!value) return;

  // Try to extract the main content (e.g., .result.report)
  let content: string;
  if (typeof value === "object" && "result" in value) {
    const result = value.result as Record<string, unknown>;
    if ("report" in result && typeof result.report === "string") {
      content = result.report;
    } else {
      content = JSON.stringify(result, null, 2);
    }
  } else {
    content = JSON.stringify(value, null, 2);
  }

  // Save to file
  const outPath = join(run.dir, "export.md");
  writeFileSync(outPath, content);
  this.notify?.(`Exported to ${outPath}`, "info");
}
```

### 4. **Better Error Display**

**Effort**: 20 minutes
**Impact**: Low - but improves DX

Parse known error patterns from result.json:

```typescript
if (state.status === "failed") {
  const value = readJsonFile(join(run.dir, "result.json"));
  if (value && typeof value === "object" && "error" in value) {
    const error = String((value as { error: unknown }).error);

    // Parse common errors
    if (error.includes("not callable:")) {
      const match = error.match(/not callable: "([^"]+)"/);
      if (match) {
        lines.push(
          `  ✗ Syntax error: tried to call string "${match[1].slice(0, 50)}"`,
        );
        lines.push(
          `  💡 Did you wrap an f-string in extra parens? Use f"..." not (f"...")`,
        );
      }
    } else if (error.includes("Eval error:")) {
      lines.push(`  ✗ ${error.split("\n")[0]}`);
    } else {
      lines.push(`  ✗ ${clip(error, width - 4)}`);
    }
  } else if (state.reason) {
    lines.push(`  ✗ ${state.reason}`);
  }
}
```

## Implementation Order

1. **Smart Result Rendering** - Do this first, biggest bang for buck
2. **Better Error Display** - Piggyback on result rendering changes
3. **Export Result** - Nice to have, quick win
4. **Expandable Checkpoints** - Do last, less critical

## Testing

After each change:

```bash
npm run build
jake pi.dev  # Opens pi in this dir
# Trigger workflow run
# Open dashboard with /sema:workflows or ctrl+alt+s
# Test new features
```

## Alternative: Just Use CLI Tools

If TUI improvements are low priority, add CLI commands instead:

```bash
# Add to package.json scripts:
"workflow:result": "sema workflow view --run-id",
"workflow:list": "sema workflow list --json | jq",
"workflow:export": "sema workflow export --run-id --output"
```

These might already exist in `sema` CLI - check `sema workflow --help`.
