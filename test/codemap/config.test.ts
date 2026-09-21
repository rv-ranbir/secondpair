import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CODEMAP_CONFIG,
  loadCodemapConfig,
  mergeCodemapConfig,
} from "../../src/codemap/config.js";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "secondpair-cfg-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("loadCodemapConfig", () => {
  it("returns defaults when nothing is present", async () => {
    expect(await loadCodemapConfig(dir)).toEqual(DEFAULT_CODEMAP_CONFIG);
  });

  it("reads package.json#secondpair", async () => {
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "x",
        secondpair: { llm: true, hooks: { "pre-commit": false }, ignore: ["docs/**"] },
      }),
    );
    const cfg = await loadCodemapConfig(dir);
    expect(cfg.llm).toBe(true);
    expect(cfg.hooks["pre-commit"]).toBe(false);
    expect(cfg.hooks["pre-push"]).toBe(true);
    expect(cfg.ignore).toEqual(["docs/**"]);
  });

  it("prefers .secondpair.yml over package.json", async () => {
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ secondpair: { llm: true } }),
    );
    await fs.writeFile(path.join(dir, ".secondpair.yml"), "llm: false\nhooks:\n  pre-push: false\n");
    const cfg = await loadCodemapConfig(dir);
    expect(cfg.llm).toBe(false);
    expect(cfg.hooks["pre-push"]).toBe(false);
    expect(cfg.hooks["pre-commit"]).toBe(true);
  });

  it("rejects unknown keys", async () => {
    await fs.writeFile(path.join(dir, ".secondpair.yml"), "unknown: 1\n");
    await expect(loadCodemapConfig(dir)).rejects.toThrow(/Invalid/);
  });
});

describe("mergeCodemapConfig", () => {
  it("fills defaults", () => {
    expect(mergeCodemapConfig({})).toEqual(DEFAULT_CODEMAP_CONFIG);
  });
});
