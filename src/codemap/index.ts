// Codemap: secondpair's optional, persistent repo-memory feature (formerly the
// standalone `repocairn` package, merged in). Everything re-exported here is
// safe to import unconditionally — no tree-sitter/wasm or MCP SDK involved —
// so `secondpair review` always works even without the optional codemap deps
// installed. Building/serving the index itself needs those deps; that code
// lives behind dynamic imports in cli.ts, not here. See ./heavy.js.
export { selectContext, estimateTokens, type ContextEntry } from "./graph.js";
export { detectSignals, type Signal, type SignalKind } from "./signals.js";
export { DEFAULT_IGNORE, isIgnored, matchesGlob } from "./ignore.js";
export {
  CODEMAP_YML,
  DEFAULT_CODEMAP_CONFIG,
  formatCodemapYml,
  loadCodemapConfig,
  mergeCodemapConfig,
  type CodemapConfig,
} from "./config.js";
export {
  DEFAULT_ANTHROPIC_MODEL,
  OPENAI_BASE_URL,
  OPENROUTER_BASE_URL,
  getModel,
  resolveProvider,
  structuredCall,
  type Provider,
  type ProviderSettings,
  type StructuredCallOptions,
} from "./llm.js";
export { getFileInfo, searchSymbols, type FileInfo, type SymbolMatch } from "./query.js";
export { INDEX_DIR, INDEX_FILE, emptyIndex, indexPath, loadIndex, saveIndex } from "./store.js";
export type { CodemapFileEntry, CodemapIndex } from "./types.js";
export { runSetup, TARGETS, type Target, type SetupOptions } from "./setup.js";
