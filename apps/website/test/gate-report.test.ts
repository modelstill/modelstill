import { describe, expect, test } from "bun:test";
import { binCounts, checkHighlight, metricInsight, verdictWords } from "../src/lib/gate-report";

const check = (passed: boolean, value: number | null, measured = true) => ({
  name: "metric_lower_bound",
  threshold: 0.68,
  value,
  passed,
  estimate: null,
  low: null,
  high: null,
  measured,
  reason: null,
});

describe("gate report", () => {
  test("a check reads as its name, the measured value and the threshold", () => {
    expect(checkHighlight(check(true, 0.6971))).toEqual({ name: "metric_lower_bound", measured: "0.6971", threshold: "at least 0.68", passed: true });
    expect(checkHighlight(check(false, null, false)).measured).toBe("not measured");
  });

  test("a metric insight carries the after value and the change in points", () => {
    const insight = metricInsight({
      name: "set_f1",
      before: { value: 0.7, low: 0.65, high: 0.75 },
      after: { value: 0.741, low: 0.7, high: 0.78 },
      difference: 0.041,
      low: 0.01,
      high: 0.07,
      paired: true,
      verdict: "better",
      improved: 12,
      regressed: 3,
    });
    expect(insight.value).toBe("0.741");
    expect(insight.delta!.signed).toBe("+4.1 pts");
    expect(insight.delta!.tone).toBe("positive");
  });

  test("a metric missing on one side has no change", () => {
    const insight = metricInsight({ name: "x", before: null, after: { value: 0.5, low: 0.4, high: 0.6 }, difference: null, low: null, high: null, paired: false, verdict: null });
    expect(insight.delta).toBeNull();
    expect(metricInsight({ name: "x", before: null, after: null, difference: null, low: null, high: null, paired: false, verdict: null }).value).toBe("n/a");
  });

  test("verdicts read as words", () => {
    expect(verdictWords("no_detectable_difference")).toBe("no detectable difference");
    expect(verdictWords(null)).toBe("no verdict");
  });

  test("bin counts come from the metric's histogram, or nothing", () => {
    const histograms = [{ metric: "score", bins: [{ low: 0, high: 0.5, count: 3 }, { low: 0.5, high: 1, count: 7 }] }];
    expect(binCounts(histograms, "score")).toEqual([3, 7]);
    expect(binCounts(histograms, "other")).toEqual([]);
  });
});
