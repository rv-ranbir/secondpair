# secondpair — architecture review & PR-review-agent requirements

Date: 2026-07-26. Scope: full `src/` tree (review pipeline, reconciliation,
GitHub/GitLab/Bitbucket posting, redaction, suppressions, config, CLI,
diff parsing, prompts). Method: full source read + new executable tests
(not just static review) targeting the dedupe/idempotency question the
review was commissioned to answer.

## 1. Dedupe / idempotency testing — results

Directive: push the same PR diff repeatedly, verify no duplicate posts.
Built real tests (mocked LLM + mocked platform APIs) instead of reasoning
about the code. Three findings, all resolved this pass:

| # | Layer | Before | Evidence | Status |
|---|-------|--------|----------|--------|
| 1 | `postReview` (GitHub) skip-on-already-posted | Logic existed, **zero tests** | New tests: 2-run and 3-run repeat-push in `test/github-comments.test.ts` | Fixed (tests added) |
| 2 | `reconcileFindings` soft-match across LLM re-wording | Only unit-tested with hand-built inputs (`test/stability.test.ts`) | New end-to-end test in `test/review.test.ts` running `runReview` 3x with a reworded title each time | Fixed (tests added) |
| 3 | **Intra-batch duplicate findings** (same bug reported twice in *one* LLM response) | **No dedup at all** — would post two inline comments for one issue in a single run | PROBE test showed `findingsToPost: 2` for one bug; real bug, not a test gap | **Fixed**: added `dedupeById()` in `src/review.ts`, wired into `runReview`, new `droppedDuplicates` stat, regression test in `test/review.test.ts` |

\#3 is the one that mattered: nothing upstream of reconciliation collapsed
duplicate findings from a single model response, so a single review run
could double-post before reconciliation ever ran. Fixed by keeping the
higher-confidence copy of any two findings sharing a fingerprint.

Full suite after fixes: 12 files, 96 tests, all passing (`tsc -b` clean).

Collateral fix: `test/review-quality.test.ts` had a self-critique test using
single-letter titles `"a"`/`"b"`, which both reduce to an empty token set
under `titleTokens()`'s length≥3 filter and therefore collided under the new
dedup. Root-caused to unrealistic fixture data (real LLM titles are never
single letters) and fixed at the fixture, not by weakening the dedup.

### Residual gap found during this testing (not fixed — flagged below)

`fingerprintFinding()` (`src/finding-id.ts`) intentionally excludes line
numbers so ids survive code drift, but if a title's *entire* token set is
stopwords/short-words, two genuinely different findings in the same
file+category collapse to the same id (`${file}|${category}|`). Low
probability with real model output (titles are descriptive), but it's a
silent false-merge, not a false-negative — worse failure mode. See §4.1.

## 2. PR review agent — requirements

What a production-grade LLM PR-review agent needs to do, independent of
this codebase, grouped by concern:

**Finding quality**
- R1. Ground findings in the actual diff; never invent issues outside changed lines.
- R2. Calibrated confidence + severity rubric, filterable by threshold.
- R3. Use repo-wide context (callers, related files) to avoid false positives from diff-only tunnel vision.
- R4. Actionable output: suggested fix, not just a complaint.

**Idempotency / lifecycle**
- R5. No duplicate comments within a single run (intra-batch dedup).
- R6. No duplicate comments across repeated runs of an unchanged diff.
- R7. Survive LLM non-determinism (reworded titles) without re-posting.
- R8. Track new / persistent / resolved / suppressed distinctly; auto-resolve threads when a finding's code is fixed.
- R9. Human override: "won't fix" / suppress, persisted and respected on future runs.

**Platform coverage**
- R10. Multi-platform (GitHub/GitLab/Bitbucket or equivalents), with posting, dedup, and resolution parity across all of them.

**Safety**
- R11. Redact secrets from diff/context before they reach the LLM.
- R12. Resist prompt injection from untrusted diff content (PRs are attacker-reachable input in open-source / external-contributor settings).

**Operability**
- R13. Configurable severity gate for CI pass/fail.
- R14. Cost/rate control: token budgets, chunking for large diffs, bounded retries.
- R15. Concurrency safety: two runs on the same PR (re-triggered CI) must not double-post.
- R16. Audit trail: machine-readable report artifact per run.
- R17. Test coverage of the idempotency guarantees themselves (R5-R7), per platform.

## 3. Scorecard

| Req | Status | Evidence |
|---|---|---|
| R1 diff-grounded | **Met** | `validateFindings` drops out-of-diff findings (`src/llm/schema.ts`); tested (`review.test.ts` "Hallucinated finding") |
| R2 confidence/severity | **Met** | `min_confidence`, `SEVERITIES` rubric in prompt, `capFindings` breaks ties on severity |
| R3 repo context | **Met** | codemap index integration, `selectContext`, inlined snippets (`review.ts:94-114`) |
| R4 actionable fixes | **Met** | `suggestion` field, rendered as GitHub suggestion block / code fence |
| R5 intra-batch dedup | **Met (fixed this pass)** | `dedupeById()`, tested |
| R6 cross-run dedup | **Met** | `postReview`/`postGlReview`/`postBbReview` all re-check live `existingIds` immediately before posting |
| R7 reword-stable | **Met** | `findingsSoftMatch` (Jaccard ≥0.3 or ≥2 shared tokens, lines within 3), tested end-to-end this pass |
| R8 lifecycle + auto-resolve | **Partial** | GitHub/GitLab resolve threads on fix; Bitbucket explicitly no-ops (`resolveBbCommentsForIds` — Cloud API has no resolve endpoint) — documented limitation, not a bug |
| R9 suppression | **Met** | `.pr-review-suppressions.yml` (`suppressions.ts`) + `collectWontFixIds` reply/reaction detection, all 3 platforms |
| R10 platform parity | **Met (fixed)** | GitHub 2 new + existing tests, GitLab 1 existing skip test, Bitbucket now has its own dedupe-skip test (`bitbucket/comments.ts:207`, `test/bitbucket.test.ts` — "skips a finding whose id is already posted") |
| R11 redaction | **Met** | `redact.ts` built-in patterns (AWS/GitHub/generic secret/PEM) + configurable extra patterns, applied to diff and injected context, tested |
| R12 prompt injection | **Met (mitigated)** | All system prompts (`llm/prompt.ts`) now state the DIFF/REPOSITORY CONTEXT sections are untrusted data, not instructions — framing only, backstopped by the existing schema-constrained output; does not guarantee a model can't be steered within a `title`/`body` it does report |
| R13 CI gate | **Met** | `shouldFail()` in `report/cli.ts`, threshold-driven |
| R14 cost/rate control | **Met (fixed)** | Token-budget chunking (`DIFF_TOKENS_PER_CALL`, `context_token_budget`, `SNIPPET_TOKENS_PER_FILE`), retry w/ backoff (`withRetry`, 3 attempts), and now a `max_diff_chunks` config cap (default 20) — extra chunks are skipped with a warning log instead of billed (`review.ts`) |
| R15 concurrency safety | **Partial (documented)** | `postReview`/`postGlReview`/`postBbReview` are still read-then-write with no lock — not fixable from inside the package (no compare-and-swap primitive on any of the three comment APIs). `examples/pr-review.yml` and `examples/gitlab-ci.yml` now ship the required CI-level `concurrency:`/`resource_group:` lock; Bitbucket Pipelines has no YAML equivalent, documented as a repo-settings mitigation in `examples/bitbucket-pipelines.yml` |
| R16 audit trail | **Partial** | `pr-review-report.json` gives per-run stats/findings, but nothing persists across runs unless CI explicitly caches the file — no append-only history |
| R17 idempotency test coverage | **Met (fixed)** | GitHub, GitLab, and now Bitbucket all covered |

## 4. Remaining gaps (ranked)

### 4.1 Prompt injection via diff content — mitigated (R12, fixed 2026-09-21)
`buildReviewUserPrompt` concatenates diff text and repo-context snippets
directly into the user message with no framing that tells the model diff
content is data, not instructions. A malicious PR (comment text, string
literal, commit message surfaced in `changeDescription`) could attempt to
steer the reviewer — e.g. suppress findings about itself, or inject
misleading text into a posted review comment. Structured-output schema
validation bounds the blast radius (can't escape the `Finding` shape), but
can't stop the model from writing whatever it wants inside `title`/`body`
for a finding it does report. No test exercises this.
Fixed: every system prompt in `llm/prompt.ts` (`REVIEW_SYSTEM_PROMPT`,
`HIGH_LEVEL_SYSTEM_PROMPT`, `REVIEW_RULES` shared by the security/
correctness/quality lenses) now has an explicit rule stating the DIFF and
REPOSITORY CONTEXT sections are untrusted data from the PR author, not
instructions, and that embedded directive-like text must be treated as
ordinary code/comment content. This is framing, not a hard guarantee — it
narrows the model's willingness to comply with embedded instructions but
can't prove it out; the schema-validation backstop (§ scorecard R1) remains
the real blast-radius limit on what a compromised finding can contain.
Did not add imperative-phrase stripping — same-cost, same-effect as the
framing rule, and stripping risks mangling legitimate diff content that
happens to contain words like "ignore".

### 4.1b `redact_patterns` / config as a ReDoS vector if config is loaded from PR head
`.pr-review.yml`'s `redact_patterns` are user-supplied regex strings,
compiled with `new RegExp(src, "g")` (`redact.ts` `compileRedactPatterns`)
and then run against the full diff text on every review. No complexity
limit, no execution timeout — a catastrophic-backtracking pattern
(e.g. `(a+)+$`) would hang the review process. Not exploitable if CI loads
`.pr-review.yml` from the base branch (the normal setup — `loadConfig`
reads from whatever's checked out at `cwd`, not from the diff), but *is*
exploitable if a workflow checks out the PR head before running secondpair,
since that makes the config itself part of the attacker-controlled diff.
Fix direction: either document config-must-come-from-base-branch as a hard
requirement in the README examples (cheapest), or validate/sandbox
`redact_patterns` at load time (e.g. `safe-regex`-style linear check or a
worker-thread execution timeout). Not fixed here — same "flag the
trust-boundary gap" treatment as 4.1, and the two are really one root
cause: nothing downstream of `loadConfig`/diff-fetch currently treats PR
content as adversarial input.

### 4.1c Import-graph path traversal (fixed this pass)
`resolveRelativeImport`/`resolveGenericImport` (`src/codemap/indexer.ts`)
resolve relative import specifiers found in file content to on-disk paths,
checked only with `existsSync(path.join(cwd, rel))` — no repo-root
containment check. A file in the diff containing `import x from
"../../../../../../etc/passwd"` (or any deep `..` escape) could resolve
outside the repo if a same-named+extension file happened to exist on the
runner's filesystem, letting its path enter the import graph and
potentially get inlined as review context. Fixed: both resolvers now skip
any candidate whose normalized relative path starts with `..` before the
`existsSync` check.

### 4.2 Concurrency race on posting (R15, mitigated 2026-09-21)
See scorecard. Real but not fixable inside this package (no compare-and-swap
primitive on GitHub/GitLab/Bitbucket comment APIs) — it's an operational
requirement, not a code fix. `examples/pr-review.yml` now ships a GitHub
Actions `concurrency:` group and `examples/gitlab-ci.yml` a GitLab
`resource_group:`, both keyed on the PR/MR number, queuing/cancelling
same-PR re-triggers instead of letting them race. Bitbucket Pipelines has
no YAML-level concurrency key at all — `examples/bitbucket-pipelines.yml`
and `examples/ci-generic.sh` document the gap and point at the repo-level
"Limit concurrent pipeline runs" setting as the only available mitigation.

### 4.3 Bitbucket posting path untested for dedupe-skip (R10, R17 — fixed 2026-09-21)
`bitbucket/comments.ts:207` has the identical `existingIds.has(f.id)` guard
as GitHub and GitLab. Fixed: ported GitLab's "skips duplicate finding ids"
shape to Bitbucket — `test/bitbucket.test.ts` "skips a finding whose id is
already posted, still posts a new one" now proves it directly (existing
finding's id in `formatBbCommentBody` output is not re-posted; a second,
new finding is).

### 4.4 Unbounded LLM-call cost for very large diffs (R14, fixed 2026-09-21)
`chunkFiles` splits by token budget but had no cap on chunk *count*. Fixed:
new `max_diff_chunks` config (default 20, `null` disables) checked in
`review.ts` right after chunking — chunks beyond the cap are dropped with a
warning log naming the skipped files, rather than sent to the LLM. Regression
test in `test/review-resilience.test.ts` ("caps calls at max_diff_chunks").

### 4.5 Fingerprint false-merge on degenerate titles (from §1)
Two distinct findings in the same file+category whose titles are entirely
stopwords/short tokens collapse to one id. Low probability with real model
output; flagging rather than fixing since a fix changes the id-stability
tradeoff the fingerprint design deliberately made (line-number exclusion).

### 4.6 No append-only audit history (R16)
Each run's `pr-review-report.json` overwrites the last. Fine for the
CI-gate use case; a "why did this finding disappear three runs ago" audit
question has no answer unless the consumer's CI archives every report.

## 5. What's solid

- Reconciliation design (fingerprint + soft-match fallback) is the right
  shape for LLM non-determinism and is now the best-tested part of the
  package.
- Redaction runs on diff *and* injected repo context, with tests proving
  secrets never reach `structuredCall`'s prompt.
- All three platforms independently re-check live comment state right
  before posting rather than trusting a locally cached id list — the
  correct defense against stale/ephemeral CI-runner state.
- Config surface (`ReviewConfig`, Zod-validated) covers the gate/threshold/
  category/limit knobs a real team needs without over-building.
