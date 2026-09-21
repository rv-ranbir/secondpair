# secondpair — the second pair of eyes

LLM-powered PR reviewer with whole-repo context. Reviews a diff (local,
staged, or a GitHub/GitLab/Bitbucket PR), posts inline comments, gates CI
on severity. Ships with an optional built-in **codemap** — a persistent
repo memory (symbols, import graph, LLM summaries) — so review isn't
diff-blind when it's installed: it sees callers, related files, and
project context, not just the patch.

The codemap is genuinely optional. It needs a handful of heavier
dependencies (tree-sitter/wasm for parsing, `@modelcontextprotocol/sdk` for
the `mcp` command) declared as `optionalDependencies` — if they fail to
install (or you skip them with `--omit=optional`), `secondpair review` still
works, just diff-only.

## Install

```bash
npm install --save-dev secondpair                    # with codemap support
npm install --save-dev --omit=optional secondpair     # diff-only, no codemap
```

Needs an LLM API key (same resolution used for both review and the codemap):

```bash
export ANTHROPIC_API_KEY=sk-ant-...      # default, recommended
# or: OPENAI_API_KEY / OPENROUTER_API_KEY / SECONDPAIR_API_KEY+SECONDPAIR_BASE_URL+SECONDPAIR_MODEL
```

## Quick start

```bash
cd your-repo
npx secondpair init                      # one-time: builds repo memory, installs git hooks (needs the optional deps)
npx secondpair review --staged           # review staged changes, print report
npx secondpair review --base main        # review branch vs main
```

Nothing to configure to get useful output — defaults are sane
(`fail_on: off`, `min_confidence: 0.5`). CI never fails on findings until you
opt in (`fail_on: high` or `--fail-on high`); until then it's report/post
only. Add `.pr-review.yml` only when you want to change them (see
[Config](#config)).

## Reviewing a real PR (posting comments + CI gate)

Pick your platform, set its token, run with `--post`:

**GitHub** (GitHub Actions: `GITHUB_TOKEN` is provided automatically)
```bash
export GITHUB_TOKEN=ghp_...
npx secondpair review --pr 123 --repo owner/name --post --fail-on high
```

**GitLab** (in GitLab CI, `CI_SERVER_URL`/`CI_PROJECT_ID`/`CI_MERGE_REQUEST_IID`
are auto-detected; set a token as `GITLAB_TOKEN` or `GL_TOKEN`)
```bash
export GITLAB_TOKEN=glpat-...
npx secondpair review --post --fail-on high     # host auto-detected via GITLAB_CI env
```

**Bitbucket** (`BITBUCKET_WORKSPACE`/`BITBUCKET_PR_ID` auto-detected in
Bitbucket Pipelines; auth via token or app password)
```bash
export BITBUCKET_TOKEN=...                      # or BITBUCKET_USERNAME + BITBUCKET_APP_PASSWORD
npx secondpair review --post --fail-on high
```

`--host` overrides auto-detection if you're running somewhere the CI env
vars aren't set. Exit code is 1 when any active finding is at/above
`fail_on` — wire that into your pipeline as the merge gate.

### Example: GitHub Actions

```yaml
- run: npx secondpair review --pr ${{ github.event.pull_request.number }} --repo ${{ github.repository }} --post
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

Re-running on the same PR (new commit, or CI re-triggered) never
double-posts — each platform re-checks live existing comment ids right
before posting, on top of run-to-run fingerprint reconciliation.

## Config (`.pr-review.yml`, optional)

```yaml
fail_on: off               # critical|high|medium|low|info|off — CI exit-1 threshold; default "off" never fails, still posts/reports
min_confidence: 0.5
ignore: ["**/*.generated.ts", "vendor/**"]
context_token_budget: 8000 # codemap context injected per chunk
context_snippets: 3
signal_detector: true      # deterministic hook/error-handling/control-flow scan, injected as prompt context
categories:                # turn any off
  bug: true
  security: true
  missing-tests: true
  naming: true
  complexity: true
  custom: true
limits:
  max_findings_per_file: 5
  max_total: 30
self_critique: false       # extra LLM pass that only drops findings, never adds
huge_pr_token_threshold: 120000 # diff tokens above which review switches to critical/high-only + split suggestion; null disables
parallel_agents: true      # split each chunk into concurrent security/correctness/quality lens calls (more LLM calls, specialized findings); set false for one sequential call
redact_secrets: true       # strip secrets from diff/context before they reach the LLM
redact_patterns: []        # extra regexes, on top of built-in AWS/GitHub-token/PEM/etc
write_suppressions: false  # persist "won't fix" replies to .pr-review-suppressions.yml
custom_instructions: ""
custom_instructions_file: ".pr-review-instructions.md" # optional guide file (any name/extension — .md, .mdc, ...); if it exists, its content REPLACES custom_instructions above
```

Prefer a standalone file over the inline `custom_instructions` string once your
rules grow past a line or two — easier to edit/review, and each
project/company can keep its own review guide (house style, focus areas,
things to always flag) without touching the YAML. None of this is mandatory
— missing files just fall through to the next source. Precedence (highest
first):

1. `.secondpair/instructions.mdc` or `.secondpair/instructions.md` — same
   convention as `.claude`/`.cursor`/`.secondpair`. Nothing to configure, just
   drop the file in.
2. `custom_instructions_file` (default `.pr-review-instructions.md`)
3. inline `custom_instructions` above

This only adds to the "CUSTOM REVIEW INSTRUCTIONS" prompt section — it never
replaces secondpair's own review guidelines (what counts as a finding,
severity, output format), only layers project-specific guidance on top.

Suppress a finding permanently: reply "won't fix" (or react 👎) on its PR
comment, or hand-edit `.pr-review-suppressions.yml` with the finding id
from the report.

## `secondpair index`

Builds/updates the codemap (`.secondpair/index.json`): per-file symbols,
import graph, and LLM summaries. Git-hook-triggered and hash-incremental —
only changed files get re-indexed, never a full rebuild unless you pass
`--full`. Needs the optional codemap dependencies installed (see Install
above); `secondpair review` never needs this command to have been run, it
just reviews diff-only without it.

## Codemap commands

Everything below needs the optional codemap dependencies installed:

- `secondpair init` — write config, install git hooks, build the first index.
- `secondpair index` — build/update the index (see above).
- `secondpair hook <phase>` — run from a git hook (`pre-commit`/`pre-push`); installed by `init`.
- `secondpair context <files...>` — print token-budgeted context for a set of files.
- `secondpair query <term>` — search indexed symbols/paths (`--file` for one file's full record).
- `secondpair setup` — wire the codemap into detected AI tools (MCP server + usage rules).
- `secondpair mcp` — run an MCP server (stdio) exposing the codemap as tools.

## More detail

- Agent-oriented internals reference (pipeline, invariants to preserve when
  editing): [`AGENTS.md`](./AGENTS.md)
- Architecture review, requirements scorecard, known gaps:
  [`docs/architecture-review.md`](./docs/architecture-review.md)
