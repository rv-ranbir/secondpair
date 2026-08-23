# Lifecycle reconciliation fix (v0.1.6)

This document describes a bug in secondpair’s incremental PR review path (`--post`) where **persistent** and **resolved** lifecycle counts were wrong — often showing identical numbers (e.g. `11 persistent · 11 resolved`) even when only some (or none) of the original findings were still open.

**Released in:** `secondpair@0.1.6` / `repocairn@0.1.6`  
**Merged:** PR #3 (`cursor/fix-carryforward-resolved-count-d6d8`)

---

## Problem we were trying to solve

secondpair tracks findings across CI runs on the same PR using fingerprint ids embedded in inline comments and a hidden state blob in the summary review comment (`review-state.ts`). On each new commit it:

1. Re-analyzes only **files changed since the last reviewed head SHA**
2. **Carries forward** findings on unchanged files without calling the LLM again
3. Classifies every prior id as **new**, **persistent**, **resolved**, or **suppressed**

That lifecycle line appears in the terminal report, the posted PR summary, and drives thread resolution on GitHub/GitLab when findings are fixed.

### Reported symptoms

| Scenario | Expected | Observed (bug) |
|----------|----------|----------------|
| 11 findings initially; 1 fixed on a changed file | `10 persistent · 1 resolved` | `11 persistent · 11 resolved` |
| All 11 fixed in code | `0 persistent · 11 resolved`, no active findings | Still showed 11 persistent (and often 11 resolved) |
| Summary with zero findings | Lifecycle line showing how many were resolved | Only “✓ No findings.” with no lifecycle detail |

The counts were misleading for humans and could cause incorrect behavior (e.g. trying to resolve threads for ids that were also counted as still active).

---

## Background: how incremental review works

When `--post` is used, the CLI (`cli.ts`) loads prior state from the embedded summary comment:

```
Previous run (head SHA A, 11 findings)
        │
        ▼
New push (head SHA B)
        │
        ├─ compare A → B → changedFiles
        │
        ├─ findings on changed files  → previousFindings → LLM re-analyze
        │
        └─ findings on unchanged files → carryForwardFindings → skip LLM
```

After the LLM returns, `reconcileFindings()` (`reconcile.ts`) compares current output against prior ids:

- Id in current output + was in previous → **persistent**
- Id in current output + not in previous → **new**
- Id in previous + absent from current → **resolved**
- Id in suppressions file or “won’t fix” reply → **suppressed**

Carry-forward findings are **intentionally absent** from the LLM output (their files were not re-analyzed). They are merged back into the active result in `review.ts` as still-open issues.

---

## Root causes

Several bugs stacked on top of each other.

### 1. Carry-forward ids classified as resolved, then added to persistent

`reconcileFindings()` saw carry-forward ids in `previousIds` but not in the LLM’s `currentIds`, so it marked them **resolved**. `review.ts` then appended the same ids to **persistent** when merging carry-forward findings — without removing them from **resolved**.

Result: the same ids appeared in both buckets → `11 persistent · 11 resolved`.

### 2. Carry-forward applied to re-analyzed files

If a finding’s **file was in `changedFiles`** but the finding still landed in `carryForwardFindings` (mis-split or stale state), it was merged into active results even when the LLM no longer reported it — i.e. the issue was **fixed** but stayed **persistent**.

### 3. Empty compare → everything carried forward

When head SHA advanced but `compareCommits` returned **no changed files**, the old logic pushed **all** prior findings into carry-forward with `changedFiles = new Set()` and **no LLM re-check**. Nothing could ever become resolved until someone touched a file.

### 4. Duplicate prior state from local JSON when posting

With `--post`, the CLI loaded prior ids/findings from both:

- the embedded PR summary state (correct for CI), and
- local `pr-review-report.json` (stale artifact from a prior run)

That could inflate `previousIds` and confuse reconciliation.

### 5. Terminal report hid lifecycle when findings list was empty

`formatReport()` returned early on zero findings without printing the lifecycle line, so an “all resolved” run looked like a clean first review with no history.

---

## Fixes applied

### `reconcile.ts` — `retainedIds`

Added an optional `retainedIds` set: prior ids that are still active but deliberately absent from this LLM pass (carry-forward on unchanged files). They are **excluded from resolved**:

```typescript
for (const id of previous) {
  if (!currentIds.has(id) && !suppressed.has(id) && !retained.has(id)) {
    reconciliation.resolved.push(id);
  }
}
```

### `review.ts` — filter carry-forward + pass retained ids

1. **Filter** `carryForwardFindings` to exclude files in `changedFiles` (re-analyzed files cannot carry forward).
2. Pass filtered ids as `retainedIds` into `reconcileFindings()`.
3. Merge carry-forward into `persistent` only (no post-hoc resolved filter needed).

### `cli.ts` — `splitFindingsSinceLastReview()` + skip local JSON on `--post`

1. Extracted shared logic for GitHub / GitLab / Bitbucket into `splitFindingsSinceLastReview()`.
2. **Empty compare fallback:** if head SHA changed but compare returns no files, put all prior findings in `previousFindings` and re-analyze everything (`changedFiles = undefined`) instead of carrying all forward.
3. When `--post`, start with empty `previousIds` / `previousFindings` from local JSON; embedded PR state is the source of truth.

### `report/cli.ts` — lifecycle line when empty

When `findings.length === 0` but `reconciliation` is present, still print the lifecycle line (e.g. `0 persistent · 11 resolved`).

---

## Expected behavior after fix

| Scenario | Lifecycle | Active findings |
|----------|-----------|-----------------|
| 11 initial; 1 fixed on changed file; 10 on unchanged files | `10 persistent · 1 resolved` | 10 |
| All 11 fixed on re-analyzed files | `0 persistent · 11 resolved` | 0 |
| No new commits (same head SHA) | All prior → carry-forward | Same count as last run |
| Head moves, compare empty | Full re-analyze of all prior findings | Whatever LLM reports |

Posted summary comments and GitHub/GitLab thread resolution use the same `reconciliation.resolved` list, so fixed findings should now resolve threads correctly.

---

## Files changed

| File | Change |
|------|--------|
| `src/reconcile.ts` | `retainedIds` option |
| `src/review.ts` | Filter carry-forward; wire `retainedIds` |
| `src/cli.ts` | `splitFindingsSinceLastReview()`; skip local JSON on `--post`; empty-compare fallback |
| `src/report/cli.ts` | Lifecycle line when zero findings |
| `test/stability.test.ts` | Unit test for `retainedIds` |
| `test/review.test.ts` | Integration tests: partial resolve, all resolved, wrong carry-forward |
| `test/report.test.ts` | Terminal lifecycle when empty |

---

## How to verify locally

```bash
npm run test:pr-review
```

Relevant test names:

- `carries forward findings for files untouched since the last review…`
- `marks all re-analyzed findings resolved when the LLM returns nothing`
- `does not carry forward findings that were re-analyzed on changed files`
- `does not mark retained ids as resolved when absent from current output`
- `shows lifecycle counts when there are no active findings`

For a real PR, run two CI passes with `--post`: fix one finding, push, and confirm the summary shows matching persistent/resolved counts and resolves the correct inline thread.

---

## Related docs

- `AGENTS.md` — pipeline overview and reconciliation step
- `docs/architecture-review.md` — requirement R8 (track new / persistent / resolved distinctly)
- `docs/test-scenario-matrix.md` — reconciliation test coverage
- `src/review-state.ts` — embedded state blob format
