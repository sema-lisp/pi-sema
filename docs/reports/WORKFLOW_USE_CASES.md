# Workflow vs Tool — When to Use Which

## TL;DR Decision Tree

```
Does it need multiple LLM calls in sequence/parallel? → Workflow
Is it stateless compute/transform/lookup? → Tool
Do you need resume-ability after failure? → Workflow
Can it complete in one shot? → Tool
Does it need phase tracking/reporting? → Workflow
```

## Real Use Cases for Workflows (Not Theoretical)

### 1. **Code Audit Pipelines**

**Problem**: You want to check 50 repos for security issues, compliance violations, or tech debt

- **Phase 1**: Clone/discover repos (file ops, no LLM)
- **Phase 2**: Parallel scan with 8 workers (LLM)
- **Phase 3**: Aggregate findings by severity (LLM)
- **Phase 4**: Generate executive summary (LLM)
- **Why workflow**: Costs $10, takes 30min — if it crashes at Phase 3, resume saves $7

### 2. **Documentation Generation**

**Problem**: Generate API docs from 20 modules in a codebase

- **Phase 1**: Extract symbols/functions (code parsing, no LLM)
- **Phase 2**: Parallel doc generation per module (LLM, 20 calls)
- **Phase 3**: Cross-link and index (LLM)
- **Phase 4**: Generate navigation/search (template)
- **Why workflow**: Parallel + checkpoints let you tweak Phase 3 without re-running Phase 2

### 3. **Data Migration Validation**

**Problem**: Migrate 1000 records, validate each with an LLM, report inconsistencies

- **Phase 1**: Load source data
- **Phase 2**: Parallel validation (bounded to 10 workers to avoid rate limits)
- **Phase 3**: Flag issues, auto-fix where possible
- **Phase 4**: Human review report
- **Why workflow**: Budget cap prevents runaway costs; checkpoints let you restart from failures

### 4. **Multi-Repo Refactoring**

**Problem**: Apply a breaking API change across 30 repos

- **Phase 1**: Clone repos
- **Phase 2**: Parallel analysis: does this repo use the old API? (LLM)
- **Phase 3**: Parallel refactor for affected repos (LLM)
- **Phase 4**: Run tests, report failures (shell + LLM)
- **Why workflow**: Resume after test failures; parallel bounded by CPU/network

### 5. **Content Pipeline (Your Comment Standardization)**

What we just built:

- **Phase 1**: Discover files (file ops)
- **Phase 2**: Analyze patterns (LLM, parallel)
- **Phase 3**: Derive standard (LLM, synthesize)
- **Phase 4**: Apply changes (LLM, parallel)
- **Phase 5**: Report (LLM)
- **Why workflow**: Clear phase separation, parallel processing, comprehensive reporting

## When Tools Are Better

### ✅ Use a Tool When:

- **One-shot operations**: parse a file, call an API, transform data
- **No intermediate state**: input → output, done
- **Fast (<10s)**: retrying from scratch is cheap
- **Stateless**: same input always gives same output
- **Library-like**: reusable across many contexts

**Examples**:

- `repo-annotations` (what we fixed) - scan and report, one pass, done
- File format converters
- API wrappers
- Data validators
- Code formatters

## Current UX Pain Points (What to Fix)

Based on what we just experienced:

### 1. **No Way to See Results Without CLI**

```bash
# Currently required:
cat .sema/runs/wfpi_xyz/result.json | jq -r '.result.report'

# Should be able to:
# - Click "View Report" in dashboard
# - Get formatted output in TUI
# - Copy to clipboard
```

### 2. **Dashboard Doesn't Show Result Data**

The dashboard shows:

- ✓ Status (success/failed)
- ✓ Phases
- ✓ Duration
- ✓ Checkpoints (keys only)
- ✗ Result values (e.g., the generated report)

**Fix**: Add a "Result" tab in detail view

### 3. **No Easy Way to Re-Run with Different Args**

After running once, no TUI button for "run again with different directory"

**Fix**: Add "Clone & Edit" action in dashboard

### 4. **Checkpoint Values Truncated**

```
:files = [...
```

Can't see what's actually in there without CLI

**Fix**: Expandable checkpoint viewer

### 5. **No Syntax Highlighting in TUI**

Viewing workflow source or results in TUI is plain text

### 6. **Error Messages Don't Surface Well**

Our f-string bug showed as generic "workflow body returned an error" - had to cat the result.json

**Fix**: Parse common errors (eval, schema, budget) and show inline

## Actionable Next Steps

Pick ONE to improve ergonomics:

1. **Add result viewer** to dashboard detail view
2. **Add "rerun with args" dialog** from dashboard
3. **Better error display** - parse result.json errors and show them formatted
4. **Checkpoint inspector** - expandable tree view of checkpoint data
5. **Export report button** - copy result to clipboard or save as .md

Which would make the biggest difference for YOUR usage?
