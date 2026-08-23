import { readFileSync } from "node:fs";

/** Resolve a GitHub token from the environment. */
export function resolveGhToken(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("A GitHub token is required (GITHUB_TOKEN env var).");
  }
  return token;
}

/** Resolve owner/name from an explicit --repo flag or the GITHUB_REPOSITORY env var. */
export function resolveGhRepoSlug(explicit: string | undefined): string {
  const slug = explicit ?? process.env.GITHUB_REPOSITORY;
  if (!slug) throw new Error("Pass --repo owner/name or set GITHUB_REPOSITORY when using --pr.");
  return slug;
}

/**
 * Auto-detect the PR number in GitHub Actions when --pr is omitted, mirroring
 * GitLab's CI_MERGE_REQUEST_IID / Bitbucket's BITBUCKET_PR_ID convenience.
 * Prefers GITHUB_EVENT_PATH's pull_request.number; falls back to parsing
 * GITHUB_REF (refs/pull/123/merge) for workflow_run-style triggers.
 */
export function detectGhPrNumberFromEnv(readFile: (path: string) => string = defaultReadFile): number | null {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath) {
    try {
      const event = JSON.parse(readFile(eventPath));
      const n = event?.pull_request?.number ?? event?.number;
      if (typeof n === "number") return n;
    } catch {
      // malformed/missing event file — fall through to GITHUB_REF
    }
  }
  const m = process.env.GITHUB_REF?.match(/^refs\/pull\/(\d+)\/(merge|head)$/);
  return m ? Number(m[1]) : null;
}

function defaultReadFile(path: string): string {
  return readFileSync(path, "utf8");
}
