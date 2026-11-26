import { describe, expect, test } from "bun:test";
import { datasetCounts, latestPair, labelledCount, nextStep, reviewCandidate, stepIndex } from "../src/lib/flow";

describe("sending a compared case to review", () => {
  test("keeps the input and labels each answer with its run and model", () => {
    const candidate = reviewCandidate(
      {
        inputHash: "h1",
        input: { posting: "We use dbt" },
        expected: ["dbt"],
        before: { score: 1, output: ["dbt"], metrics: {} },
        after: { score: 0, output: [], metrics: {} },
      },
      { model: "gpt-cloud" },
      { model: "student-v2" },
    );
    expect(candidate).toEqual({
      inputHash: "h1",
      input: { posting: "We use dbt" },
      outputs: { "before (gpt-cloud)": ["dbt"], "after (student-v2)": [] },
    });
  });

  test("falls back to plain labels when the runs are unknown", () => {
    const candidate = reviewCandidate(
      { inputHash: "h", input: "x", expected: null, before: { score: 1, output: "a", metrics: {} }, after: { score: 0, output: "b", metrics: {} } },
      null,
      null,
    );
    expect(Object.keys(candidate.outputs)).toEqual(["before", "after"]);
  });
});

describe("the latest pair of runs", () => {
  test("is the two newest runs, older first", () => {
    const runs = [
      { id: "a", createdAt: "2026-11-01T00:00:00Z" },
      { id: "c", createdAt: "2026-11-03T00:00:00Z" },
      { id: "b", createdAt: "2026-11-02T00:00:00Z" },
    ];
    expect(latestPair(runs)).toEqual({ before: "b", after: "c" });
  });

  test("needs two runs", () => {
    expect(latestPair([{ id: "a", createdAt: "2026-11-01T00:00:00Z" }])).toBeNull();
  });
});

describe("dataset counts", () => {
  test("count each review state and the labelled rows", () => {
    const items = [{ reviewState: "queued" }, { reviewState: "accepted" }, { reviewState: "corrected" }, { reviewState: "none" }, { reviewState: "accepted" }];
    expect(datasetCounts(items)).toEqual({ all: 5, none: 1, queued: 1, accepted: 2, corrected: 1 });
    expect(labelledCount(items)).toBe(3);
  });
});

describe("stepping through rows with j and k", () => {
  test("moves by one and stops at either end", () => {
    expect(stepIndex(null, 1, 3)).toBe(0);
    expect(stepIndex(0, 1, 3)).toBe(1);
    expect(stepIndex(2, 1, 3)).toBe(2);
    expect(stepIndex(0, -1, 3)).toBe(0);
    expect(stepIndex(null, -1, 3)).toBe(0);
    expect(stepIndex(null, 1, 0)).toBeNull();
  });
});

describe("the next step on the overview", () => {
  const base = { evalRuns: 2, pendingReview: 0, labelled: 0, trainRuns: 0, lastGatePassed: null, mode: "off" } as const;

  test("starts with an eval run", () => {
    expect(nextStep({ ...base, evalRuns: 0 })).toBe("evals");
  });

  test("then clears the review queue", () => {
    expect(nextStep({ ...base, pendingReview: 3 })).toBe("review");
  });

  test("then trains on labelled data", () => {
    expect(nextStep({ ...base, labelled: 40 })).toBe("training");
  });

  test("then gates the trained student", () => {
    expect(nextStep({ ...base, labelled: 40, trainRuns: 1 })).toBe("gates");
    expect(nextStep({ ...base, labelled: 40, trainRuns: 1, lastGatePassed: false })).toBe("gates");
  });

  test("then deploys once the gate passes, and watches traffic after", () => {
    expect(nextStep({ ...base, trainRuns: 1, lastGatePassed: true })).toBe("deployment");
    expect(nextStep({ ...base, trainRuns: 1, lastGatePassed: true, mode: "shadow" })).toBe("traffic");
  });

  test("with nothing labelled yet it compares runs", () => {
    expect(nextStep(base)).toBe("evals");
  });
});
