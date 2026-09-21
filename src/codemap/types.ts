/** Extensions signals.ts/indexer.ts treat as TS/JS-family source. Lives here
 * (not indexer.ts) so signals.ts — statically imported by review.ts's hot
 * path — never pulls in indexer.ts's tree-sitter-extract.ts chain. */
export const TS_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

export interface CodemapFileEntry {
  /** sha1 of file content at index time. */
  hash: string;
  /** One-paragraph LLM summary; empty string when indexed with --no-llm. */
  summary: string;
  /** Exported/public symbol signatures. */
  symbols: string[];
  /** Repo-relative paths of resolved relative imports. */
  imports: string[];
}

export interface CodemapIndex {
  version: 1;
  generatedAt: string;
  files: Record<string, CodemapFileEntry>;
}
