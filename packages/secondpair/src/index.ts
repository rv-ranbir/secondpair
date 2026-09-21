export { runReview } from "./review.js";
// runIndex (codemap indexing) needs the optional tree-sitter deps — dynamic
// import it directly from "./codemap/index-command.js" instead of via this
// barrel, so importing secondpair as a library never forces those installs.
export { selectContext, loadIndex } from "./codemap/index.js";
export { loadConfig, DEFAULT_CONFIG } from "./config.js";
export { parseDiff, renderDiffForPrompt } from "./diff/parse.js";
export { validateFindings, reviewOutputSchema, findingSchema } from "./llm/schema.js";
export { formatReport, shouldFail } from "./report/cli.js";
export {
  fingerprintFinding,
  normalizeTitle,
  parseFindingId,
  embedFindingId,
  findingsSoftMatch,
  titleSimilarity,
} from "./finding-id.js";
export { reconcileFindings } from "./reconcile.js";
export { loadSuppressions, SUPPRESSIONS_FILENAME } from "./suppressions.js";
export * from "./types.js";
