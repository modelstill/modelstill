import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CompareCasesTable } from "../src/components/evals/compare-cases-table";
import { ComparisonHeadline } from "../src/components/evals/comparison-headline";
import { MetricComparisonTable } from "../src/components/evals/metric-comparison-table";
import { createApiClient, type ComparedCase, type Comparison } from "../src/lib/api";
import { caseDelta, casesIn, changeCounts, formatPValue, headlineSentence, sortByRegression } from "../src/lib/compare";

const cases = [
  { inputHash: "same", before: 1, after: 1 },
  { inputHash: "fixed", before: 0, after: 1 },
  { inputHash: "slightly-broken", before: 0.8, after: 0.6 },
  { inputHash: "broken", before: 1, after: 0 },
];

const comparison: Comparison = {
  before: {},
  after: {},
  difference: 0.045,
  low: 0.012,
  high: 0.081,
  verdict: "better",
  fixed: 20,
  broken: 2,
  pairedCases: 307,
  signTest: { pValue: 0.00012 },
  metrics: [
    { name: "pooled_f1", before: { value: 0.7, low: 0.66, high: 0.74 }, after: { value: 0.76, low: 0.72, high: 0.8 }, difference: 0.06, low: null, high: null, paired: false, verdict: null },
    { name: "exact_match", before: { value: 0.5, low: 0.44, high: 0.56 }, after: { value: 0.55, low: 0.49, high: 0.61 }, difference: 0.05, low: 0.02, high: 0.08, paired: true, verdict: "better" },
  ],
  cases,
};

const detail: ComparedCase = {
  inputHash: "broken",
  input: { posting: "We run Snowflake" },
  expected: { tags: ["snowflake"] },
  before: { score: 1, output: { tags: ["snowflake"] }, metrics: { set_f1: 1 } },
  after: { score: 0, output: { tags: ["dbt"] }, metrics: { set_f1: 0 } },
};

describe("case lists", () => {
  test("the delta is after minus before, and null when a side is not numeric", () => {
    expect(cases.map(caseDelta)).toEqual([0, 1, expect.closeTo(-0.2, 10), -1]);
    expect(caseDelta({ before: "x", after: 1 })).toBeNull();
  });

  test("sorting by regression puts the worst-broken case first and fixed cases last", () => {
    expect(sortByRegression(cases).map((c) => c.inputHash)).toEqual(["broken", "slightly-broken", "same", "fixed"]);
  });

  test("filters keep fixed, broken or unchanged cases", () => {
    expect(casesIn(cases, "fixed").map((c) => c.inputHash)).toEqual(["fixed"]);
    expect(casesIn(cases, "broken").map((c) => c.inputHash)).toEqual(["slightly-broken", "broken"]);
    expect(casesIn(cases, "unchanged").map((c) => c.inputHash)).toEqual(["same"]);
    expect(casesIn(cases, "all")).toHaveLength(4);
    expect(changeCounts(cases)).toEqual({ all: 4, fixed: 1, broken: 2, unchanged: 1 });
  });

  test("p-values are readable at every size", () => {
    expect(formatPValue(0.5)).toBe("p = 0.50");
    expect(formatPValue(0.012)).toBe("p = 0.012");
    expect(formatPValue(0.00012)).toBe("p < 0.001");
  });

  test("the headline says what the interval means", () => {
    expect(headlineSentence(comparison)).toBe(
      "After scores +0.045 [+0.012, +0.081] against before on 307 paired cases. The interval is above zero, so after is better.",
    );
    expect(headlineSentence({ ...comparison, low: -0.01, verdict: "no_detectable_difference" })).toContain(
      "The interval includes zero, so these cases cannot tell the runs apart.",
    );
    expect(headlineSentence({ ...comparison, high: -0.01, low: -0.05, difference: -0.03, verdict: "worse" })).toContain(
      "The interval is below zero, so after is worse.",
    );
  });
});

describe("comparison headline", () => {
  afterEach(cleanup);

  test("shows the paired difference, the verdict with an icon and the sign test", () => {
    render(<ComparisonHeadline comparison={comparison} />);
    expect(screen.getByText("+0.045 [+0.012, +0.081]")).toBeTruthy();
    const verdict = screen.getAllByText("better")[0]!.closest("[data-slot=badge]")!;
    expect(verdict.querySelector("svg")).toBeTruthy();
    expect(screen.getByTestId("sign-test").textContent).toContain("p < 0.001");
    expect(screen.getByTestId("sign-test").textContent).toContain("20 fixed, 2 broken");
  });
});

describe("metric comparison table", () => {
  afterEach(cleanup);

  test("every metric shows both runs with intervals and the difference", () => {
    render(<MetricComparisonTable metrics={comparison.metrics} />);
    const rows = screen.getAllByTestId("metric-row");
    expect(rows.map((row) => row.getAttribute("data-metric"))).toEqual(["pooled_f1", "exact_match"]);
    const paired = rows[1]!;
    expect(within(paired).getByText("0.50 [0.44, 0.56]")).toBeTruthy();
    expect(within(paired).getByText("0.55 [0.49, 0.61]")).toBeTruthy();
    expect(within(paired).getByText("+0.05 [+0.02, +0.08]")).toBeTruthy();
    expect(within(paired).getByText("better")).toBeTruthy();
  });

  test("a metric without per-case scores says why it has no paired interval", () => {
    render(<MetricComparisonTable metrics={comparison.metrics} />);
    const unpaired = screen.getAllByTestId("metric-row")[0]!;
    expect(within(unpaired).getByText("+0.060")).toBeTruthy();
    expect(unpaired.textContent).toContain("no per-case scores");
  });
});

function caseApi() {
  const requested: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    requested.push(String(input));
    return new Response(JSON.stringify({ case: detail }), { status: 200 });
  }) as typeof fetch;
  return { api: createApiClient({ baseUrl: "http://api.test", fetchImpl }), requested };
}

describe("compare cases table", () => {
  afterEach(cleanup);

  test("rows start sorted by regression and filter by change", () => {
    const { api } = caseApi();
    render(<CompareCasesTable cases={cases} loadCase={(hash) => api.getComparedCase("a", "b", hash)} />);
    const order = () => screen.getAllByTestId("compare-case-row").map((row) => row.getAttribute("data-input-hash"));
    expect(order()).toEqual(["broken", "slightly-broken", "same", "fixed"]);
    fireEvent.click(screen.getByRole("radio", { name: /Broken/ }));
    expect(order()).toEqual(["broken", "slightly-broken"]);
    fireEvent.click(screen.getByRole("radio", { name: /Fixed/ }));
    expect(order()).toEqual(["fixed"]);
    fireEvent.click(screen.getByRole("radio", { name: /Unchanged/ }));
    expect(order()).toEqual(["same"]);
  });

  test("a selected case shows its input, the expected answer and both outputs side by side", async () => {
    const { api, requested } = caseApi();
    render(<CompareCasesTable cases={cases} loadCase={(hash) => api.getComparedCase("a", "b", hash)} />);
    fireEvent.click(screen.getAllByTestId("compare-case-row")[0]!);
    await waitFor(() => expect(screen.getByTestId("case-diff")).toBeTruthy());
    expect(requested[0]).toBe("http://api.test/v1/eval-runs/compare/case?before=a&after=b&inputHash=broken");
    const diff = screen.getByTestId("case-diff");
    expect(within(diff).getByTestId("case-input").textContent).toContain("We run Snowflake");
    const fields = within(diff).getAllByTestId("teacher-diff-row");
    expect(fields.map((row) => row.getAttribute("data-path"))).toEqual(["tags"]);
    expect(fields[0]!.textContent).toContain("[snowflake]");
    expect(fields[0]!.textContent).toContain("[dbt]");
    const scores = within(diff).getAllByTestId("case-score-row");
    expect(scores.map((row) => row.getAttribute("data-metric"))).toEqual(["score", "set_f1"]);
    expect(scores[1]!.textContent).toContain("-1");
  });
});
