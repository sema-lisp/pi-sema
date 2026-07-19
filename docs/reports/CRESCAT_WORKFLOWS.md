# Crescat-Specific Workflow Ideas

Based on analysis of `/Users/helge/code/crescat/agents` git history and workflow patterns.

## Context: What Crescat Does

From analyzing the agents/ directory and git history:

- **Product**: Festival/event management SaaS (shifts, venues, public forms, entitlements, etc.)
- **Stack**: Laravel backend, Vue 3 frontend, MySQL/SQLite
- **Workflow**: Plans in `agents/plans/`, archived when done, learnings in `agents/reflections.md`
- **Common Issues**: Sentry errors, Nightwatch failures, cross-tenant scope leaks, broadcast races

## Workflow 1: **Triage Cross-Source Duplicate Detection**

**Problem**: From reflections.md (2026-06-30):

> Sentry+Nightwatch observe the SAME production exceptions, so cross-source duplicate PRs are structural (PRs #1475/#1477 were the identical (bool)-cast fix ~13h apart)

**Workflow**:

1. **Phase: Discover** - List all open PRs labeled `Triage Fix`
2. **Phase: Fingerprint** - For each PR, extract changed files (`git diff --name-only`)
3. **Phase: Detect Duplicates** - Compare fingerprints, group PRs touching same files
4. **Phase: Analyze** - LLM reads each PR pair's diffs, determines if truly duplicate
5. **Phase: Report** - Generate report with:
   - Confirmed duplicates (close one, comment on other)
   - Same-file different-fix (needs human review)
   - False positives (different concerns, same file)

**Budget**: ~$0.50 per run (10 PRs, 2-3 comparisons)

**Value**: Prevents duplicate fixes for same Sentry/Nightwatch issue

---

## Workflow 2: **Plan Archival Assistant**

**Problem**: Plans accumulate in `agents/plans/` but archival is manual (condense, move, commit)

**Workflow**:

1. **Phase: Discover** - List all plans in `agents/plans/` with status `✅ Done`
2. **Phase: Read** - Load each plan's full content
3. **Phase: Condense** - LLM generates one-page executive summary (strip TODOs, implementation details, keep learnings)
4. **Phase: Extract Learnings** - Identify non-obvious discoveries that belong in `reflections.md`
5. **Phase: Preview** - Show condensed summary + proposed reflection entries for human approval
6. **Phase: Apply** (optional) - Move to `archive/`, append to `reflections.md`, commit

**Budget**: ~$0.20 per plan

**Value**: Reduces archival friction, ensures learnings are captured

---

## Workflow 3: **Scope Leak Audit**

**Problem**: From reflections.md:

> An "ungrouped `orWhere` escapes the tenant scope" finding is a FALSE POSITIVE when the `orWhere` lives inside a Laravel `#[Scope]` method.

**Workflow**:

1. **Phase: Discover** - Grep for `orWhere` calls in controllers/models
2. **Phase: Classify** - For each, determine:
   - Is it inside a `#[Scope]` method? (safe)
   - Is it wrapped in `where(closure)`? (safe)
   - Is it bare in controller? (potential leak)
3. **Phase: Test** - For suspected leaks, generate `->toSql()` test cases
4. **Phase: Report** - List confirmed leaks, false positives, and edge cases

**Budget**: ~$1.00 for full codebase scan

**Value**: Catches tenant-scope leaks before production (2:1 false positive rate, needs validation)

---

## Workflow 4: **Observer Cascade Audit**

**Problem**: From reflections.md (2026-06-26):

> A pre-build observer/cascade audit table can be incomplete — the festival-template-engine's `observer-audit.md` missed ~8 suppressed model-event cascades

**Workflow**:

1. **Phase: Discover** - List all models with observers (`creating`, `updating`, `deleting`, `deleted` hooks)
2. **Phase: Trace** - For each observer, trace what it creates/updates/deletes
3. **Phase: Cross-Check** - Compare against any existing `Model::withoutEvents` calls
4. **Phase: Gaps** - Identify observers that are suppressed but do load-bearing work (FK setup, denormalization)
5. **Phase: Report** - Generate audit table with:
   - Observer name
   - What it does
   - Whether it's ever suppressed
   - Risk if suppressed (NOT NULL constraint? data loss?)

**Budget**: ~$2.00 for 50+ models

**Value**: Prevents "observers suppressed, constraints fail" bugs

---

## Workflow 5: **Migration Drift Detector**

**Problem**: From reflections.md (2026-06-12):

> Editing an already-recorded migration in place creates silent environment drift — squashed 39 migrations, then 4 later commits edited it (added timestamps, index) → DBs that ran intermediate version missing columns/indexes permanently

**Workflow**:

1. **Phase: Discover** - Find migrations modified after their initial commit
2. **Phase: Analyze** - For each:
   - When was it first committed?
   - What changes happened after?
   - Are those changes additive (safe-ish) or destructive?
3. **Phase: Environment Check** - Query staging/prod schema, compare against current migration
4. **Phase: Report** - List drift: "Migration X is missing column Y on staging"
5. **Phase: Generate Fix** - Create new migration to reconcile drift

**Budget**: ~$1.00

**Value**: Catches "edited migration after deploy" drift before it causes 500s

---

## Workflow 6: **Broadcast Race Condition Scanner**

**Problem**: From reflections.md (2026-05-03):

> When two broadcasts have synchronous-then-queued ordering on the same channel, the LATER one is the load-bearing post-cascade signal — the earlier emits before data exists.

**Workflow**:

1. **Phase: Discover** - Find all broadcast events
2. **Phase: Trace** - For each, determine:
   - Is it synchronous or queued?
   - What data does it broadcast?
   - When is that data created (before or after the broadcast)?
3. **Phase: Race Detection** - Find broadcasts that emit before their data exists
4. **Phase: Report** - List races with suggested fixes (move broadcast to job/after-commit)

**Budget**: ~$0.75

**Value**: Prevents "broadcast fires, client fetches, data not there yet" bugs

---

## Most Valuable for Crescat?

**Top 3**:

1. **Plan Archival Assistant** - Immediate friction reduction, runs weekly
2. **Triage Duplicate Detection** - Prevents duplicate work on every Sentry/Nightwatch spike
3. **Observer Cascade Audit** - High-value one-time audit, prevents entire class of bugs

**Build first**: Plan Archival Assistant (easiest, immediate value, teaches the workflow system)
