import { afterEach, describe, expect, it, vi } from "vitest";
import { detectGhPrNumberFromEnv, resolveGhRepoSlug, resolveGhToken } from "../src/github/auth.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveGhToken", () => {
  it("reads GITHUB_TOKEN from the environment", () => {
    vi.stubEnv("GITHUB_TOKEN", "tok-123");
    expect(resolveGhToken()).toBe("tok-123");
  });

  it("throws when no token is set", () => {
    vi.stubEnv("GITHUB_TOKEN", "");
    expect(() => resolveGhToken()).toThrow(/GITHUB_TOKEN/);
  });
});

describe("resolveGhRepoSlug", () => {
  it("prefers the explicit flag over the env var", () => {
    vi.stubEnv("GITHUB_REPOSITORY", "env/repo");
    expect(resolveGhRepoSlug("flag/repo")).toBe("flag/repo");
  });

  it("falls back to GITHUB_REPOSITORY", () => {
    vi.stubEnv("GITHUB_REPOSITORY", "acme/api");
    expect(resolveGhRepoSlug(undefined)).toBe("acme/api");
  });

  it("throws when neither is set", () => {
    vi.stubEnv("GITHUB_REPOSITORY", "");
    expect(() => resolveGhRepoSlug(undefined)).toThrow(/GITHUB_REPOSITORY/);
  });
});

describe("detectGhPrNumberFromEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads pull_request.number from GITHUB_EVENT_PATH", () => {
    vi.stubEnv("GITHUB_EVENT_PATH", "/tmp/event.json");
    const readFile = vi.fn().mockReturnValue(JSON.stringify({ pull_request: { number: 42 } }));
    expect(detectGhPrNumberFromEnv(readFile)).toBe(42);
    expect(readFile).toHaveBeenCalledWith("/tmp/event.json");
  });

  it("falls back to GITHUB_REF when the event file has no PR number", () => {
    vi.stubEnv("GITHUB_EVENT_PATH", "");
    vi.stubEnv("GITHUB_REF", "refs/pull/123/merge");
    expect(detectGhPrNumberFromEnv()).toBe(123);
  });

  it("returns null when neither source has a PR number", () => {
    vi.stubEnv("GITHUB_EVENT_PATH", "");
    vi.stubEnv("GITHUB_REF", "refs/heads/main");
    expect(detectGhPrNumberFromEnv()).toBeNull();
  });

  it("falls through to GITHUB_REF when the event file can't be read", () => {
    vi.stubEnv("GITHUB_EVENT_PATH", "/tmp/missing.json");
    vi.stubEnv("GITHUB_REF", "refs/pull/7/head");
    const readFile = vi.fn().mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(detectGhPrNumberFromEnv(readFile)).toBe(7);
  });
});
