// Zero-dependency PR ref parsing, split out of github.ts so cli.ts and
// github/comments.ts can use it without pulling in @octokit/rest (optional,
// ~16MB) — that stays behind a dynamic import, only resolved when the
// resolved host is actually github.
export interface PrRef {
  owner: string;
  repo: string;
  pull_number: number;
}

export function parseRepoSlug(slug: string): { owner: string; repo: string } {
  const [owner, repo] = slug.split("/");
  if (!owner || !repo) throw new Error(`Invalid repo slug "${slug}" — expected owner/name.`);
  return { owner, repo };
}
