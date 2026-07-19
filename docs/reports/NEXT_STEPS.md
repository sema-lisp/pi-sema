# Pi-Sema Workflows — What We Learned & Next Steps

## Summary of Test Results

✅ **Workflow execution works** - All 5 phases completed, parallel execution succeeded, checkpoints persisted, results generated  
⚠️ **UX needs work** - Can't easily view results, no way to re-run, dashboard is bare-bones  
❓ **Use cases unclear** - Need to think about when workflows > tools

---

## Two Separate UIs (Both Need Attention)

### 1. **TUI Dashboard** (`/sema:workflows` or `ctrl+alt+s`)

- **What it shows**: Run list, phases, status, truncated checkpoints
- **What it doesn't show**: Full results, errors with context, markdown reports
- **Location**: `src/ui/dashboard.ts`
- **Status**: ✅ Working but basic

### 2. **Web Viewer** (`sema workflow view`)

- **What it is**: Web UI served at http://localhost:8899
- **How to test**: `sema workflow view` (opens in browser)
- **Location**: Implemented in Rust (`sema/crates/sema-workflow/src/viewer/`)
- **Status**: ❓ Unknown - you said it might be broken, haven't tested yet

---

## Test the Web Viewer Now

```bash
# Start the web viewer
sema workflow view

# Should open http://127.0.0.1:8899 in browser
# You have 3 recent runs to inspect:
# - wfpi_mrpoow61_43e4e9 (success, 1 file, $0.16)
# - wfpi_mrponlgu_91042d (success, 0 files, $0.03)
# - wfpi_mrpomjir_0af8fc (failed, f-string bug)
```

If it's broken, tell me:

- What happens when you run it?
- Does the page load?
- What do you see / what errors?
- Browser console errors?

---

## Practical Workflow Use Cases (Ranked)

### Tier 1: Clear Wins

1. **Multi-repo operations** (audit 50 repos, migrate breaking changes)
2. **Parallel content generation** (docs for 20 modules, resume on failure)
3. **Data pipeline with validation** (process 1000 records, bounded parallelism, budget cap)

### Tier 2: Maybe Workflows

4. **Long-running research** (scrape → analyze → synthesize, hours, resumable)
5. **Multi-step refactoring** (discover → plan → apply → test → report)

### Tier 3: Just Use Tools

6. ~~Comment standardization~~ (we built it as a demo, but honestly a tool could do this)
7. ~~One-shot transforms~~ (no resume needed, fast, stateless)

**Verdict**: Workflows shine when you have:

- ≥3 phases that need isolation
- Parallel LLM calls (bounded fanout)
- Resume-ability (costs >$1, >10min runtime)
- Budget constraints (cap spend, don't blow $100 on typo)

---

## What to Fix First (Your Choice)

Pick ONE based on how you want to use workflows:

### Option A: **Improve TUI Dashboard** (if you use pi's TUI heavily)

**Quick win**: Smart result rendering (30 min)

- See `DASHBOARD_IMPROVEMENTS.md` for exact code
- Detects `.result.report` markdown and renders it readable
- Shows structured data prettified instead of `{...` truncated

**Test**:

```bash
npm run build && jake pi.dev
# Run a workflow
# Open dashboard (/sema:workflows)
# Hit Enter on a completed run
# See actual results, not JSON soup
```

### Option B: **Fix/Test Web Viewer** (if web UI is priority)

**Immediate action**: Test what's actually broken

```bash
sema workflow view
# Navigate to runs
# Report what doesn't work
```

**Then**: Fix upstream in `sema` repo (it's a Rust web server, not pi-sema's code)

### Option C: **Add CLI Export Commands** (if TUI/web don't matter)

**Quick workaround**: Add npm scripts

```json
// package.json
"scripts": {
  "wf:list": "ls -t .sema/runs | head -10",
  "wf:result": "cat .sema/runs/$(ls -t .sema/runs | head -1)/result.json | jq -r '.result.report // .result'",
  "wf:export": "cat .sema/runs/$RUN/result.json | jq -r '.result.report' > export.md"
}
```

### Option D: **Rethink Workflows Entirely** (if use cases don't justify it)

Maybe pi-sema workflows aren't the right abstraction for YOUR use case.

**Alternative**: Just use `sema_eval` with a script that calls tools in sequence

- No phases, no checkpoints
- But: full control, simpler mental model
- Trade-off: no resume, no budget tracking

---

## What I Recommend

1. **Test the web viewer first** - if it works, maybe you don't need TUI improvements
2. **If web viewer is broken**, decide:
   - Fix it in `sema` repo (upstream, Rust)
   - OR improve TUI dashboard (here, TypeScript)
3. **Pick one real use case** you actually want to automate
   - Multi-repo audit?
   - Doc generation?
   - Code migration?
4. **Build THAT workflow** - if it's painful, you'll know what to fix

The comment-standardization workflow was a good test, but it's not a compelling real-world use case. Pick something you'd actually run weekly.

---

## Files Created

- ✅ `WORKFLOW_TEST_SUMMARY.md` - What we learned from testing
- ✅ `WORKFLOW_USE_CASES.md` - When workflows vs tools, practical examples
- ✅ `DASHBOARD_IMPROVEMENTS.md` - Concrete TUI fixes with code
- ✅ `NEXT_STEPS.md` (this file) - What to do next

**Your move**: Test the web viewer, then tell me what you want to focus on.
