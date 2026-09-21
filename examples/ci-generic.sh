#!/usr/bin/env bash
# Portable CI recipe — any pipeline that can run bash + Node 20.
# Does NOT run secondpair index in CI. Expect `.secondpair/index.json` committed.
#
# Concurrency: secondpair's dedupe check is read-then-write, so two runs
# racing on the same PR (rapid re-push) can both post. Configure your CI
# system to queue/cancel same-PR runs of this job (GitHub Actions:
# `concurrency:`; GitLab: `resource_group:`; others: check your platform's
# per-branch/per-PR concurrency control).
set -euo pipefail

: "${ANTHROPIC_API_KEY:=${OPENAI_API_KEY:-${OPENROUTER_API_KEY:-}}}"
if [ -z "${ANTHROPIC_API_KEY}" ] && [ -z "${OPENAI_API_KEY:-}" ] && [ -z "${OPENROUTER_API_KEY:-}" ]; then
  echo "Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY" >&2
  exit 2
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node 20+ required (found $(node -v))" >&2
  exit 2
fi

# Install CLI (prefer npm once published; git URL works for private forks)
if [ -n "${PR_REVIEW_INSTALL:-}" ]; then
  npm install -g "$PR_REVIEW_INSTALL"
else
  npm install -g secondpair
fi

if [ ! -f .secondpair/index.json ]; then
  echo "WARNING: .secondpair/index.json missing — reviewing diff-only. Run \`secondpair init\` locally and commit the index." >&2
fi

ARGS=(review --fail-on "${FAIL_ON:-high}" --json pr-review-report.json)

# Auto-post when CI provides a PR identity
if [ -n "${GITHUB_TOKEN:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ] && [ -n "${PR_NUMBER:-${GITHUB_EVENT_PULL_REQUEST_NUMBER:-}}" ]; then
  ARGS+=(--post --pr "${PR_NUMBER:-$GITHUB_EVENT_PULL_REQUEST_NUMBER}" --repo "$GITHUB_REPOSITORY" --host github)
elif [ -n "${BITBUCKET_PR_ID:-}" ]; then
  ARGS+=(--post --host bitbucket)
fi

secondpair "${ARGS[@]}"
