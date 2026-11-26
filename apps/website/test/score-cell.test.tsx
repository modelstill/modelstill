import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { RunScore } from "../src/components/evals/run-score";
import { metricLabel } from "../src/lib/format";

afterEach(cleanup);

describe("metric labels", () => {
  test("turn a metric name into words and keep acronyms upper case", () => {
    expect(metricLabel("pooled_f1")).toBe("pooled F1");
    expect(metricLabel("roc_auc")).toBe("roc AUC");
    expect(metricLabel("exact_match")).toBe("exact match");
  });

  test("a run without a primary metric is scored by its per-case mean", () => {
    expect(metricLabel(null)).toBe("per-case mean");
  });
});

describe("run score", () => {
  test("names the primary metric next to the score and interval", () => {
    const { container } = render(<RunScore run={{ mean: 0.819, low: 0.78, high: 0.855, primaryMetric: "pooled_f1" }} digits={3} />);
    expect(container.textContent).toBe("pooled F10.819 [0.780, 0.855]");
    expect(container.querySelector("[data-slot=metric-name]")?.textContent).toBe("pooled F1");
  });

  test("says per-case mean when the run has no primary metric", () => {
    const { container } = render(<RunScore run={{ mean: 0.812, low: 0.771, high: 0.849, primaryMetric: null }} digits={3} />);
    expect(container.textContent).toContain("per-case mean");
    expect(container.textContent).toContain("0.812 [0.771, 0.849]");
  });
});
