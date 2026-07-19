# Workflow Recommendations Summary

After analyzing `/Users/helge/code/crescat/agents` workflow patterns and your open-source project landscape, here are concrete workflow recommendations.

---

## Context Discovered

### Crescat (Private Work)

- **Product**: Festival/event management SaaS
- **Workflow**: Sophisticated plan lifecycle (`plans/` → `archive/`)
- **Pain Points**:
  - Manual plan archival (condense, extract learnings, commit)
  - Cross-source duplicate PRs (Sentry + Nightwatch = same bug, 2 PRs)
  - Scope leaks, broadcast races, observer cascade bugs (from reflections.md)

### Open Source (15+ Repos)

- **Projects**: sema ecosystem (15 repos), jake, glue, sql-splitter, dbdump, toon-php
- **Pain Points**:
  - Dependabot PRs accumulate (need review/merge)
  - Feature ideas scattered (docs/plans/, issues, ideas/)
  - Docs drift (completed features still in plans/, not archived)
  - Cross-repo sync (sema version bumps across editor plugins)

---

## Top Recommendations (Ranked by Value/Effort)

### 🥇 **Build First: Crescat Plan Archival Assistant**

**Why**:

- Immediate value (saves 15-30 min per archival)
- Low risk (read-only until human approval)
- Teaches workflow system well
- Clear success criteria

**File**: [`READY_TO_BUILD_plan-archival-assistant.md`](./READY_TO_BUILD_plan-archival-assistant.md)

**Effort**: 1-2 hours to author + test  
**ROI**: Weekly time savings, cleaner repo

---

### 🥈 **Build Second: Dependabot Auto-Merge**

**Why**:

- Eliminates 10-20 manual PR reviews/month
- Safe (CI must pass, labels must match)
- Cross-project value (all OSS repos)

**File**: [`OPENSOURCE_AUTOPILOT_WORKFLOWS.md`](./OPENSOURCE_AUTOPILOT_WORKFLOWS.md#workflow-1-dependabot-pr-auto-merge)

**Effort**: 2-3 hours (needs GitHub CLI integration)  
**ROI**: Pure automation, zero manual work after setup

---

### 🥉 **Build Third: Feature Prioritization**

**Why**:

- Data-driven roadmap
- Surfaces quick wins
- Consolidates scattered ideas

**File**: [`OPENSOURCE_AUTOPILOT_WORKFLOWS.md`](./OPENSOURCE_AUTOPILOT_WORKFLOWS.md#workflow-2-feature-prioritization-from-docsissues)

**Effort**: 3-4 hours (needs tuning for scoring)  
**ROI**: Better decision-making, less "what should I build?" paralysis

---

## Specialized Workflows (Build Later)

### For Crescat

- **Triage Duplicate Detection** - Prevents duplicate Sentry/Nightwatch PRs
- **Scope Leak Audit** - Scans for tenant-scope escape via `orWhere`
- **Observer Cascade Audit** - Documents model event cascades
- **Migration Drift Detector** - Finds edited-after-deploy migrations
- **Broadcast Race Scanner** - Detects premature broadcasts

See: [`CRESCAT_WORKFLOWS.md`](./CRESCAT_WORKFLOWS.md)

### For Open Source

- **Doc Cleanup** - Moves implemented features to `docs/archived/`
- **Sema Ecosystem Sync** - Version bumps across 15 editor plugins
- **Mutation Testing** - Random monkeywrench testing

See: [`OPENSOURCE_AUTOPILOT_WORKFLOWS.md`](./OPENSOURCE_AUTOPILOT_WORKFLOWS.md)

---

## What NOT to Build (Yet)

### ❌ Generic "Review All PRs" Workflow

**Why**: Too broad, low signal-to-noise, LLM struggles with code review nuance

### ❌ Fully Autonomous Release Workflow

**Why**: Already automated via GitHub Actions, no manual steps to automate

### ❌ "Write Code for Me" Workflow

**Why**: Workflows excel at triage/analysis/reporting, not greenfield code generation

---

## Deployment Strategy

### Phase 1: Learn the System (This Week)

1. Build **Plan Archival Assistant** for Crescat
2. Run it on a test branch
3. Fix ergonomics issues you discover

### Phase 2: Add Value (Next 2 Weeks)

1. Build **Dependabot Auto-Merge** for OSS repos
2. Schedule it as a daily cron
3. Monitor false positive rate

### Phase 3: Scale Up (Month 2)

1. Build **Feature Prioritization**
2. Add **Doc Cleanup** workflow
3. Consider Crescat-specific audits (scope leak, duplicates)

---

## Key Insights from Analysis

### From Crescat Reflections

> **2026-06-30**: Sentry+Nightwatch observe the SAME production exceptions, so cross-source duplicate PRs are structural

→ **Workflow opportunity**: Cross-source duplicate detection

> **2026-06-26**: A pre-build observer/cascade audit table can be incomplete — missed ~8 suppressed model-event cascades

→ **Workflow opportunity**: Observer cascade audit

> **Plans lifecycle**: `plan created → phases executed → all phases done → /archive`

→ **Workflow opportunity**: Automate the archival step

### From Open Source Patterns

- Dependabot PRs are **all merged**, but manually (CI does the testing)
- Feature ideas **scattered** across docs/plans/, docs/ideas/, GitHub issues
- No cross-repo version sync tooling for sema ecosystem

→ **Workflow opportunity**: Consolidation + automation

---

## Success Metrics

### For Plan Archival

- **Time saved**: Measure before/after archival time
- **Consistency**: All done plans archived within 1 week
- **Learnings captured**: reflections.md updated automatically

### For Dependabot Auto-Merge

- **PRs merged**: Count auto-merged vs manual
- **False positive rate**: PRs that failed after auto-merge
- **Time to merge**: Median time from PR open to merge

### For Feature Prioritization

- **Roadmap clarity**: Can you answer "what's next?" in <2 minutes?
- **Quick wins shipped**: Features scored high that actually got built
- **Deprioritization confidence**: Features explicitly skipped without guilt

---

## Files Created

All documentation in `docs/reports/`:

1. **[WORKFLOW_TEST_SUMMARY.md](./WORKFLOW_TEST_SUMMARY.md)** - Test results from comment-standardization workflow
2. **[WORKFLOW_USE_CASES.md](./WORKFLOW_USE_CASES.md)** - When to use workflows vs tools
3. **[DASHBOARD_IMPROVEMENTS.md](./DASHBOARD_IMPROVEMENTS.md)** - TUI UX fixes
4. **[QUICK_FIX_RESULT_VIEWER.md](./QUICK_FIX_RESULT_VIEWER.md)** - 5-min dashboard improvement
5. **[NEXT_STEPS.md](./NEXT_STEPS.md)** - Decision tree post-testing
6. **[CRESCAT_WORKFLOWS.md](./CRESCAT_WORKFLOWS.md)** - Crescat-specific workflow ideas (6 workflows)
7. **[OPENSOURCE_AUTOPILOT_WORKFLOWS.md](./OPENSOURCE_AUTOPILOT_WORKFLOWS.md)** - OSS maintenance workflows (5 workflows)
8. **[READY_TO_BUILD_plan-archival-assistant.md](./READY_TO_BUILD_plan-archival-assistant.md)** - Production-ready workflow with full code

---

## Next Action

**Immediate**: Build the Plan Archival Assistant

```bash
cd ~/code/sema/pi-sema
# Author via /sema:workflow or manually write the .sema file
# Test on a throwaway branch in crescat repo
```

**This Week**: Fix dashboard result viewer (5 min from QUICK_FIX_RESULT_VIEWER.md)

**Next Week**: Build Dependabot Auto-Merge

**Ongoing**: Test web viewer (`sema workflow view`), decide if TUI improvements are worth it

---

## Questions to Answer Before Building More

1. **Web viewer status**: Does `sema workflow view` work? If yes, maybe TUI improvements are lower priority
2. **Workflow vs Script**: Should some of these be bash scripts instead? (e.g., Dependabot merge)
3. **Trigger infrastructure**: How will you run these? Cron? GitHub Actions? Manual?
4. **Error handling**: What happens when a workflow fails mid-way? (Resume is the answer, but test it)

Your call on priorities! Start with Plan Archival Assistant—it's ready to build and has clear value.
