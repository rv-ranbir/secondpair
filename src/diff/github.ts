import { Octokit } from "@octokit/rest";
import type { PrRef } from "./github-ref.js";

export type { PrRef } from "./github-ref.js";
export { parseRepoSlug } from "./github-ref.js";

export function makeOctokit(token: string | undefined): Octokit {
  if (!token) {
    throw new Error("A GitHub token is required (GITHUB_TOKEN env var).");
  }
  return new Octokit({ auth: token });
}

/** Fetch the unified diff of a pull request. */
export async function getPrDiff(octokit: Octokit, pr: PrRef): Promise<string> {
  const res = await octokit.pulls.get({
    ...pr,
    mediaType: { format: "diff" },
  });
  // With the diff media type the payload is the raw diff string.
  return res.data as unknown as string;
}

export async function getPrHeadSha(octokit: Octokit, pr: PrRef): Promise<string> {
  const res = await octokit.pulls.get({ ...pr });
  return res.data.head.sha;
}

/** Paths changed between two commits on the PR's repo. */
export async function listChangedFiles(
  octokit: Octokit,
  pr: PrRef,
  base: string,
  head: string,
): Promise<Set<string>> {
  const res = await octokit.repos.compareCommits({
    owner: pr.owner,
    repo: pr.repo,
    base,
    head,
  });
  return new Set((res.data.files ?? []).map((f) => f.filename));
}
