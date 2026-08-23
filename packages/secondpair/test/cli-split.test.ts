import { describe, expect, it } from "vitest";
import { splitFindingsSinceLastReview } from "../src/cli.js";
import type { PreviousFinding } from "../src/reconcile.js";
import type { ReviewState } from "../src/review-state.js";
import type { Finding } from "../src/types.js";

function f(overrides: Partial<Finding> = {}): Finding {
  return {
    file: "src/a.ts",
    start_line: 1,
    end_line: 2,
    severity: "high",
    category: "bug",
    confidence: 0.9,
    title: "Off-by-one in loop",
    body: "x",
    suggestion: null,
    id: "id-1",
    ...overrides,
  };
}

describe("splitFindingsSinceLastReview", () => {
  it("carries every prior finding forward unchanged when compare reports zero changed files despite a different head sha", () => {
    const prev: ReviewState = {
      headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      findings: [f({ file: "src/a.ts", id: "id-1" }), f({ file: "src/b.ts", id: "id-2" })],
    };
    const previousIds = new Set<string>();
    const previousFindings: PreviousFinding[] = [];
    const carryForwardFindings: Finding[] = [];

    const changedFiles = splitFindingsSinceLastReview(
      prev,
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      new Set(), // compare returned no changed files
      previousIds,
      previousFindings,
      carryForwardFindings,
      () => {},
    );

    // No re-analysis: nothing goes to the LLM, nothing gets flagged as "new"
    // on files this push never touched.
    expect(changedFiles).toEqual(new Set());
    expect(previousFindings).toHaveLength(0);
    expect(carryForwardFindings.map((c) => c.id)).toEqual(["id-1", "id-2"]);
  });
});
