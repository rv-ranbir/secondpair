import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { readJsonFile } from "./store.js";

export const CODEMAP_YML = ".secondpair.yml";
export const PACKAGE_JSON = "package.json";

const hooksSchema = z
  .object({
    "pre-commit": z.boolean().optional(),
    "pre-push": z.boolean().optional(),
  })
  .strict()
  .optional();

const configSchema = z
  .object({
    hooks: hooksSchema,
    llm: z.boolean().optional(),
    ignore: z.array(z.string()).optional(),
  })
  .strict();

export type CodemapConfig = {
  hooks: { "pre-commit": boolean; "pre-push": boolean };
  llm: boolean;
  ignore: string[];
};

export const DEFAULT_CODEMAP_CONFIG: CodemapConfig = {
  hooks: { "pre-commit": true, "pre-push": true },
  llm: false,
  ignore: [],
};

export function mergeCodemapConfig(partial: z.infer<typeof configSchema> | undefined): CodemapConfig {
  const p = partial ?? {};
  return {
    hooks: {
      "pre-commit": p.hooks?.["pre-commit"] ?? DEFAULT_CODEMAP_CONFIG.hooks["pre-commit"],
      "pre-push": p.hooks?.["pre-push"] ?? DEFAULT_CODEMAP_CONFIG.hooks["pre-push"],
    },
    llm: p.llm ?? DEFAULT_CODEMAP_CONFIG.llm,
    ignore: p.ignore ?? [],
  };
}

/**
 * Load codemap config: `.secondpair.yml` wins over `package.json#secondpair`, else defaults.
 */
export async function loadCodemapConfig(cwd: string): Promise<CodemapConfig> {
  const ymlPath = path.join(cwd, CODEMAP_YML);
  if (existsSync(ymlPath)) {
    const raw = YAML.parse(await readFile(ymlPath, "utf8")) ?? {};
    return parsePartial(raw, CODEMAP_YML);
  }

  const pkgPath = path.join(cwd, PACKAGE_JSON);
  if (existsSync(pkgPath)) {
    let pkg: unknown;
    try {
      pkg = await readJsonFile(pkgPath);
    } catch {
      return { ...DEFAULT_CODEMAP_CONFIG, ignore: [] };
    }
    if (pkg && typeof pkg === "object" && "secondpair" in pkg) {
      const block = (pkg as { secondpair: unknown }).secondpair;
      if (block !== undefined && block !== null) {
        return parsePartial(block, `${PACKAGE_JSON}#secondpair`);
      }
    }
  }

  return { ...DEFAULT_CODEMAP_CONFIG, ignore: [] };
}

function parsePartial(raw: unknown, label: string): CodemapConfig {
  const parsed = configSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid ${label}:\n${issues}`);
  }
  return mergeCodemapConfig(parsed.data);
}

/** Serialize config for `.secondpair.yml`. */
export function formatCodemapYml(config: CodemapConfig): string {
  return YAML.stringify({
    hooks: config.hooks,
    llm: config.llm,
    ignore: config.ignore,
  });
}
