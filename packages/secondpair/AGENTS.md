# secondpair — agent reference

LLM-powered PR review CLI. "The second pair of eyes." Reviews a diff
(local, or a GitHub/GitLab/Bitbucket PR), posts inline comments, gates CI
on severity. `src/codemap/` (formerly the standalone `repocairn` package,
merged in) supplies whole-repo context — a persistent codemap — so review
isn't diff-blind when it's installed. Optional: the codemap's own heavy
deps (tree-sitter/wasm, `@modelcontextprotocol/sdk`) are
`optionalDependencies`; `review.ts` always statically imports only
`src/codemap/index.ts`'s **light barrel** (no heavy deps), so a plain
`secondpair review` never requires them. Anything heavy (indexing itself,
`init`, `hook`, `mcp`) is reached only via dynamic `import()` from specific
`cli.ts` command actions — never add a static import of a heavy codemap
module (`index-command.ts`, `indexer.ts`, `tree-sitter-extract.ts`,
`init.ts`, `mcp.ts`) from `review.ts`/`config.ts`/`index.ts`, or you
silently break the optional-dependency guarantee.

Same pattern for git hosts: GitLab and Bitbucket add zero extra deps
(plain `fetch`), but GitHub's `@octokit/rest` (~16MB) is also an
`optionalDependency` so bitbucket/gitlab-only users never resolve it.
`src/diff/github-ref.ts` holds the zero-dep `PrRef` type + `parseRepoSlug`
(statically imported everywhere); `src/diff/github.ts` holds everything
that touches `Octokit` and is only reached via dynamic `import()` in
`cli.ts`'s `review` action, gated on the resolved host actually being
github. `src/github/comments.ts` imports `Octokit` as `import type` only
(erased at compile) so it stays safe to import statically. Never add a
value-level (non-type) import of `@octokit/rest` outside `diff/github.ts`.

Package root: `packages/secondpair`. Entry points: `src/cli.ts` (bin:
`secondpair` / `pr-review`), `src/index.ts` (library exports).

## Pipeline (in call order)

```
CLI (cli.ts)
  → host.ts detectHost() — --host flag, else BITBUCKET_*/GITLAB_CI env detection
  → per-platform auth.ts resolves token + ref (github/auth.ts, bitbucket/auth.ts, gitlab/auth.ts)
  → get diff (diff/github.ts | diff/local.ts | gitlab/comments.ts | bitbucket/comments.ts)
  → config.ts loadConfig() + applyCliOverrides() (--fail-on, --write-suppressions)
  → load previous state: report/json.ts (loadPreviousIds/loadPreviousFindings from pr-review-report.json)
                          suppressions.ts (.pr-review-suppressions.yml)
                          suppress-signals.ts (won't-fix replies/reactions on prior PR comments)
  → runReview()  [review.ts] — THE core pipeline:
      1. redact.ts: strip secrets from diff text (built-in + config patterns)
      2. diff/parse.ts: parseDiff() → FileDiff[], filter ignored/deleted/no-op files
      3. if diff tokens > huge_pr_token_threshold: highLevelReview=true — HIGH_LEVEL_SYSTEM_PROMPT,
         critical/high-only, split-recommending single call (skips parallel lenses + self_critique)
      4. codemap: loadIndex + selectContext (+ inline snippets) → repo context, then redact it too;
         importer-relation entries become reviewBrief.blastRadius (skipped gracefully if no index)
      5. signal_detector: codemap's signals.ts collectSignals() — deterministic hook/error-handling/
         control-flow signals in added lines, rendered alongside the diff per chunk
      6. chunkFiles() by token budget, capped at max_diff_chunks (default 20; extras skipped +
         warning, not billed) → per chunk, either:
         - parallel_agents (and not highLevelReview): runSpecializedReview() fans out concurrent
           security/correctness/quality lens calls, merges outputs + per-lens stats.lensStats
         - else: one structuredCall() per chunk (llm/prompt.ts prompts), wrapped in retry.ts withRetry()
           (3 attempts, exponential backoff)
      7. llm/schema.ts validateFindings() — drop findings outside diff lines / below min_confidence / disabled category
      8. capFindings() — enforce per-file/total limits, lowest-confidence dropped first
      9. dedupeById() — collapse same-fingerprint findings from ONE LLM response (keeps higher confidence)
      10. optional self_critique second LLM pass (CRITIQUE_SYSTEM_PROMPT) — drop-only, never adds
      11. reconcile.ts reconcileFindings() — classify vs previousIds/previousFindings/suppressedIds
          → { active (all current, for CI gate), toPost (subset that's actually new) }
  → report/cli.ts formatReport() (terminal, shows highLevelReview banner + blast-radius line) + shouldFail() (CI gate)
  → report/json.ts writeJsonReport() → pr-review-report.json (includes highLevelReview, reviewBrief, stats.lensStats)
  → if --post: github/comments.ts postReview() | gitlab/comments.ts postGlReview() | bitbucket/comments.ts postBbReview()
      each: re-fetch LIVE existing comment ids right before posting (final dedupe net,
      independent of steps 7-9 above), post only what's not already there, resolve
      threads/discussions for reconciliation.resolved ids (Bitbucket: no-op, API can't)
```

## Key files

| File | Purpose |
|---|---|
| `src/review.ts` | `runReview()` — the whole pipeline above. `dedupeById()`, `capFindings()` exported for testing. |
| `src/finding-id.ts` | Fingerprinting. `fingerprintFinding()` = sha1(`file\|category\|sorted-significant-title-tokens`), **excludes line numbers on purpose** (survives code drift). `findingsSoftMatch()` catches reworded titles: same file+category, lines within 3, Jaccard≥0.3 or ≥2 shared tokens. |
| `src/reconcile.ts` | `reconcileFindings()` — new/persistent/resolved/suppressed classification against prior state. |
| `src/llm/prompt.ts` | System prompts (`REVIEW_SYSTEM_PROMPT`, `CRITIQUE_SYSTEM_PROMPT`) and user-prompt builders. Diff + context are concatenated raw — **no prompt-injection framing** (known gap, see `docs/architecture-review.md`). |
| `src/llm/schema.ts` | Zod schemas for LLM output + `validateFindings()` (diff/confidence/category filtering). |
| `src/diff/parse.ts` | Unified-diff parser → `FileDiff[]`. New-file line numbers only (the commentable side). |
| `src/redact.ts` | Regex-only secret redaction (AWS/GitHub/generic secret/PEM + configurable patterns). No entropy fallback. |
| `src/suppressions.ts` / `src/suppress-signals.ts` | Persisted ignore list (`.pr-review-suppressions.yml`) + detection of "won't fix"/reaction replies on the agent's own PR comments. |
| `src/host.ts` | `detectHost()` — single place resolving which platform to target (`--host` flag, else `BITBUCKET_*`/`GITLAB_CI` env). |
| `src/github/auth.ts`, `src/bitbucket/auth.ts`, `src/gitlab/auth.ts` | Per-platform credential + ref resolution only (env vars → token/workspace/repo/PR-or-MR id). No fetch/format/post logic — that's `comments.ts`. Each platform's auth and comment-posting concerns live in separate files on purpose; don't fold them back together. |
| `src/github/comments.ts`, `src/gitlab/comments.ts`, `src/bitbucket/comments.ts` | Per-platform fetch/format/posting only (imports auth from the sibling `auth.ts`). All three independently re-check live `existingIds` before posting — treat this pattern as load-bearing, don't remove it even though `reconcile.ts` already filtered. |
| `src/retry.ts` | `withRetry()` — 3 attempts, exponential backoff, wraps the non-parallel `structuredCall()` in `review.ts`. |
| `src/config.ts` | `ReviewConfig` Zod schema + `loadConfig()`/`mergeConfig()` (`.pr-review.yml`) + `isIgnored()` + `applyCliOverrides()` (the single place CLI flags — `--fail-on`, `--write-suppressions` — merge onto a loaded config; immutable, never mutates its input). `applyInstructionsFile()` resolves `custom_instructions`, all sources optional, highest precedence wins: `.secondpair/instructions.mdc`/`.md` (dir convention, like `.claude`/`.cursor`/`.secondpair`) → `custom_instructions_file` (default `.pr-review-instructions.md`) → inline `custom_instructions` in `.pr-review.yml`. Only feeds the CUSTOM REVIEW INSTRUCTIONS prompt section — never touches `REVIEW_SYSTEM_PROMPT`. |
| `src/codemap/signals.ts` | `detectSignals()` — deterministic (non-LLM) hook/error-handling/control-flow signal detection over added lines, gated by `signal_detector` config. Light module (only needs `typescript`), always statically importable. |
| `src/codemap/` | The merged-in codemap (formerly `repocairn`): `index.ts` is the light barrel (safe to import unconditionally); `index-command.ts`/`indexer.ts`/`tree-sitter-extract.ts` (indexing), `init.ts`, `mcp.ts` are heavy and only reached via dynamic `import()` from `cli.ts`. |
| `src/report/cli.ts` | Terminal formatting + `shouldFail(findings, fail_on)` — CI gate, operates on `active` findings (not just `toPost`), i.e. persistent findings still count. |
| `src/report/json.ts` | `pr-review-report.json` read/write — this file IS the cross-run dedupe state when `--post` isn't used. If CI doesn't cache it, every run without `--post` looks "all new" locally (doesn't cause duplicate posts, just loses local persistent/new distinction). |

## Key types (`src/types.ts`)

- `Finding`: `{ file, start_line, end_line, severity, category, confidence, title, body, suggestion?, id? }`. `id` set post-validation via `withFindingId()`.
- `Severity`: critical > high > medium > low > info (in that rank order, index 0 = most severe).
- `Category`: bug | security | missing-tests | naming | complexity | custom.
- `ReviewResult`: `{ findings (=active), summary, dropped, reconciliation?, findingsToPost? }`.
- `RunStats`: counts at every drop stage (`droppedValidation`, `droppedCaps`, `droppedDuplicates`, `droppedCritique`, `suppressed`, `persistent`) — use these to debug "why didn't my finding show up."

## CLI

```
secondpair index [--full] [--no-llm] [--dir] [--config]     # build/update .secondpair/index.json (optional deps)
secondpair review [--staged] [--base <ref>] [--pr <n>] [--repo <slug>]
                   [--host github|gitlab|bitbucket] [--post] [--fail-on <severity>]
                   [--no-context] [--json <path>] [--suppressions <path>] [--write-suppressions]
secondpair init | hook <phase> | context <files...> | query <term> | setup | mcp   # codemap (optional deps)
secondpair install [--github] [--bitbucket] [--gitlab] [--codemap] [--mcp] [--all] [-g] [--dry-run]
```
Host auto-detected from CI env vars if `--host` omitted (`BITBUCKET_*` → bitbucket, `GITLAB_CI` → gitlab, else github). Without `--pr`/CI env, reviews local diff (branch-vs-base or `--staged`).

`install` (`src/install-features.ts`) is the selective-install UX for `optionalDependencies` — plain `npm install secondpair` pulls in all of them (octokit + tree-sitter + MCP SDK), which is wasted weight for e.g. a bitbucket-only CI box. Install core-only with `npm install secondpair --omit=optional`, then run `secondpair install --bitbucket --codemap` (etc.) to add just the feature packages needed, pinned to the exact versions in this release's own `optionalDependencies`. `bitbucket`/`gitlab` need no extra packages (plain `fetch`) so those flags are accepted no-ops. Adding a new optional dep to `package.json` without adding it to `FEATURE_PACKAGES` in `install-features.ts` means `secondpair install` can't offer it.

## Invariants an agent editing this code must preserve

1. **Never post from `active`/`findings` directly — always post `toPost`/`findingsToPost`.** `active` includes persistent findings already on the PR.
2. Any new dedup logic goes in `review.ts` *before* `reconcileFindings()`, or in the platform `post*Review()` *live-recheck* — not just in `reconcile.ts`, which only sees one run's worth of state.
3. `fingerprintFinding()` must stay line-number-free. If you need line info in the id, that's a design change (breaks drift-tolerance) — flag it, don't silently add.
4. Redaction (`redact.ts`) runs on diff text AND injected repo context, before either reaches `structuredCall`. Keep both call sites if you touch `review.ts`.
5. Bitbucket's `resolveBbCommentsForIds` is intentionally a documented no-op (Cloud API has no thread-resolve endpoint) — not a bug, don't "fix" it into a silent failure.
6. Tests mock `src/codemap/index.js`'s `structuredCall`/`getModel` (see any `test/*.test.ts` top of file) — never let a test hit a real LLM API.
7. Env-var/credential reads live only in `host.ts` (which platform) and each platform's `auth.ts` (which token/ref) — never add a new `process.env` read in `cli.ts` or a `comments.ts`. CLI-flag-to-config merging lives only in `config.ts`'s `applyCliOverrides()` — never mutate a loaded `ReviewConfig` in place.

## Known gaps (see `docs/architecture-review.md` for full detail)

All four gaps previously tracked here are closed:
- Prompt injection: all system prompts (`llm/prompt.ts`) now state the DIFF/REPOSITORY CONTEXT sections are untrusted data, not instructions — a schema-validation backstop, not a guarantee against a determined model.
- Concurrency: not fixable in-package (no compare-and-swap on GitHub/GitLab/Bitbucket comment APIs) — `examples/pr-review.yml` and `examples/gitlab-ci.yml` now demo the required `concurrency:`/`resource_group:` lock; Bitbucket Pipelines has no YAML equivalent, documented as a repo-settings mitigation in `examples/bitbucket-pipelines.yml`.
- Bitbucket dedupe-skip now has a regression test (`test/bitbucket.test.ts` — "skips a finding whose id is already posted").
- LLM call ceiling: `max_diff_chunks` config (default 20) caps `structuredCall` invocations per run; extra chunks are skipped with a warning log rather than billed (`review.ts`).
