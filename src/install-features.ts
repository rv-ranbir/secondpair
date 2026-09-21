import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Optional-dependency groups behind `secondpair install` flags. bitbucket/gitlab
 * need no extra packages (plain fetch) — listed anyway so --bitbucket/--gitlab
 * are recognized flags, not errors. */
export const FEATURE_PACKAGES: Record<string, string[]> = {
  github: ["@octokit/rest"],
  bitbucket: [],
  gitlab: [],
  codemap: ["web-tree-sitter", "web-tree-sitter-modern", "tree-sitter-wasms", "@vscode/tree-sitter-wasm"],
  mcp: ["@modelcontextprotocol/sdk"],
};

export type Feature = keyof typeof FEATURE_PACKAGES;
export const FEATURES = Object.keys(FEATURE_PACKAGES) as Feature[];

interface PackageJson {
  optionalDependencies?: Record<string, string>;
}

function readOwnPackageJson(): PackageJson {
  // dist/install-features.js -> ../package.json; src/install-features.ts (dev) -> ../package.json
  const here = path.dirname(fileURLToPath(import.meta.url));
  return JSON.parse(readFileSync(path.join(here, "..", "package.json"), "utf8"));
}

/** Package specifiers (name@versionSpec, from our own optionalDependencies —
 * the exact versions this secondpair release was built/tested against) for
 * the given features. Unknown feature names are ignored. */
export function resolvePackageSpecs(features: string[]): string[] {
  const { optionalDependencies = {} } = readOwnPackageJson();
  const names = new Set(features.flatMap((f) => FEATURE_PACKAGES[f] ?? []));
  return [...names].map((name) => {
    const spec = optionalDependencies[name];
    return spec ? `${name}@${spec}` : name;
  });
}
