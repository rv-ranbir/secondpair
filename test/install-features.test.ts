import { describe, expect, it } from "vitest";
import { FEATURE_PACKAGES, FEATURES, resolvePackageSpecs } from "../src/install-features.js";

describe("install-features", () => {
  it("bitbucket and gitlab need no extra packages", () => {
    expect(FEATURE_PACKAGES.bitbucket).toEqual([]);
    expect(FEATURE_PACKAGES.gitlab).toEqual([]);
  });

  it("resolves specs from our own optionalDependencies versions", () => {
    const specs = resolvePackageSpecs(["github"]);
    expect(specs).toEqual([expect.stringMatching(/^@octokit\/rest@\^21\.\d+\.\d+$/)]);
  });

  it("dedupes packages shared across features and skips no-dep features", () => {
    const specs = resolvePackageSpecs(["bitbucket", "codemap", "codemap"]);
    expect(specs).toHaveLength(FEATURE_PACKAGES.codemap.length);
  });

  it("ignores unknown feature names", () => {
    expect(resolvePackageSpecs(["not-a-real-feature"])).toEqual([]);
  });

  it("FEATURES lists every key in FEATURE_PACKAGES", () => {
    expect(FEATURES.sort()).toEqual(Object.keys(FEATURE_PACKAGES).sort());
  });
});
