import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  CODEMAP_YML,
  DEFAULT_CODEMAP_CONFIG,
  formatCodemapYml,
  loadCodemapConfig,
  PACKAGE_JSON,
  type CodemapConfig,
} from "./config.js";
import { installHooks } from "./hooks.js";
import { runIndex, type IndexStats } from "./index-command.js";
import { readJsonFile } from "./store.js";

export interface InitOptions {
  /** Write `.secondpair.yml` instead of package.json#secondpair. */
  yml?: boolean;
  noHooks?: boolean;
  noIndex?: boolean;
  force?: boolean;
  log?: (msg: string) => void;
}

export interface InitResult {
  steps: string[];
  config: CodemapConfig;
  stats?: IndexStats;
}

export async function runInit(cwd: string, opts: InitOptions = {}): Promise<InitResult> {
  const log = opts.log ?? (() => {});
  await assertGitRepo(cwd);

  const steps: string[] = [];
  const config = await writeConfig(cwd, opts, steps);

  if (!opts.noHooks) {
    const hookSteps = await installHooks(cwd, { force: opts.force, config });
    steps.push(...hookSteps);
  }

  let stats: IndexStats | undefined;
  if (!opts.noIndex) {
    log("Building initial index…");
    stats = await runIndex({
      cwd,
      llm: config.llm,
      ignore: config.ignore,
      log,
    });
    steps.push(
      `Indexed ${stats.indexed} files (${stats.total} total in .secondpair/index.json)`,
    );
  }

  return { steps, config, stats };
}

async function assertGitRepo(cwd: string): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);
  try {
    await exec("git", ["rev-parse", "--is-inside-work-tree"], { cwd });
  } catch {
    throw new Error(`Not a git repository: ${cwd}. Run \`git init\` first.`);
  }
}

async function writeConfig(
  cwd: string,
  opts: InitOptions,
  steps: string[],
): Promise<CodemapConfig> {
  const ymlPath = path.join(cwd, CODEMAP_YML);
  const pkgPath = path.join(cwd, PACKAGE_JSON);
  const defaults = { ...DEFAULT_CODEMAP_CONFIG, ignore: [] as string[] };

  if (opts.yml) {
    if (existsSync(ymlPath) && !opts.force) {
      steps.push(`${CODEMAP_YML} already present — left unchanged`);
      return loadCodemapConfig(cwd);
    }
    await fs.writeFile(ymlPath, formatCodemapYml(defaults), "utf8");
    steps.push(`Wrote ${CODEMAP_YML}`);
    return defaults;
  }

  if (existsSync(ymlPath) && !opts.force) {
    // yml already wins for runtime; don't also write package.json
    steps.push(`${CODEMAP_YML} already present — left unchanged`);
    return loadCodemapConfig(cwd);
  }

  if (!existsSync(pkgPath)) {
    await fs.writeFile(
      pkgPath,
      JSON.stringify({ name: path.basename(cwd), private: true, secondpair: defaults }, null, 2) + "\n",
      "utf8",
    );
    steps.push(`Created ${PACKAGE_JSON} with secondpair config`);
    return defaults;
  }

  const raw = await readJsonFile<Record<string, unknown>>(pkgPath);
  if (raw.secondpair && !opts.force) {
    steps.push(`${PACKAGE_JSON}#secondpair already present — left unchanged`);
    return loadCodemapConfig(cwd);
  }

  raw.secondpair = defaults;
  await fs.writeFile(pkgPath, JSON.stringify(raw, null, 2) + "\n", "utf8");
  steps.push(`Wrote ${PACKAGE_JSON}#secondpair`);
  return defaults;
}
