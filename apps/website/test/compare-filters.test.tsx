import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CaseDiff } from "../src/components/evals/case-diff";
import { CompareCasesTable } from "../src/components/evals/compare-cases-table";
import { GateChanges } from "../src/components/evals/gate-changes";
import { MetricComparisonTable } from "../src/components/evals/metric-comparison-table";
import { createApiClient, type CompareCase, type ComparedCase, type MetricComparison } from "../src/lib/api";
import { casesForMetric, lineDiff, metricFilterFrom, textLines } from "../src/lib/compare";
import { compareHref } from "../src/lib/nav";

const cases: CompareCase[] = [
  { inputHash: "a", before: 1, after: 0, metrics: { exact_match: { before: 1, after: 0 }, set_f1: { before: 0.5, after: 0.75 } } },
  { inputHash: "b", before: 0, after: 1, metrics: { exact_match: { before: 0, after: 1 }, set_f1: { before: 0.5, after: 0.25 } } },
  { inputHash: "c", before: 1, after: 1, metrics: { exact_match: { before: 1, after: 1 }, set_f1: { before: 0.5, after: 0.5 } } },
];

const metrics: MetricComparison[] = [
  {
    name: "exact_match",
    before: { value: 0.67, low: 0.2, high: 0.9 },
    after: { value: 0.67, low: 0.2, high: 0.9 },
    difference: 0,
    low: -0.3,
    high: 0.3,
    paired: true,
    verdict: "no_detectable_difference",
    improved: 1,
    regressed: 1,
  },
  {
    name: "pooled_f1",
    before: { value: 0.7, low: 0.6, high: 0.8 },
    after: { value: 0.8, low: 0.7, high: 0.9 },
    difference: 0.1,
    low: null,
    high: null,
    paired: false,
    verdict: null,
    improved: null,
    regressed: null,
  },
];

const detail: ComparedCase = {
  inputHash: "a",
  input: { question: "capital of Peru" },
  expected: { answer: "Lima" },
  before: { score: 1, output: { answer: "Lima" }, metrics: {} },
  after: { score: 0, output: { answer: "unknown" }, metrics: {} },
};

const loadCase = async () => detail;

describe("filters by metric", () => {
  test("keeps the cases whose metric went up or down", () => {
    expect(casesForMetric(cases, { metric: "set_f1", direction: "improved" }).map((entry) => entry.inputHash)).toEqual(["a"]);
    expect(casesForMetric(cases, { metric: "set_f1", direction: "regressed" }).map((entry) => entry.inputHash)).toEqual(["b"]);
    expect(casesForMetric(cases, { metric: "score", direction: "regressed" }).map((entry) => entry.inputHash)).toEqual(["a"]);
    expect(casesForMetric(cases, { metric: "unknown", direction: "improved" })).toEqual([]);
  });

  test("reads and writes the filter in the compare link", () => {
    const href = compareHref("t", "x", "y", { metric: "set_f1", direction: "regressed" });
    expect(href).toBe("/tasks/t/evals/compare?before=x&after=y&metric=set_f1&change=regressed");
    expect(metricFilterFrom(new URL(href, "http://site.test").searchParams)).toEqual({ metric: "set_f1", direction: "regressed" });
    expect(metricFilterFrom(new URLSearchParams("metric=set_f1&change=sideways"))).toBeNull();
    expect(metricFilterFrom(new URLSearchParams(""))).toBeNull();
  });
});

describe("line diff", () => {
  test("values become pretty lines and strings keep their own lines", () => {
    expect(textLines({ answer: "Lima" })).toEqual(["{", '  "answer": "Lima"', "}"]);
    expect(textLines("one\ntwo")).toEqual(["one", "two"]);
    expect(textLines(null)).toEqual([]);
  });

  test("marks the lines only the expected answer or only the output has", () => {
    expect(lineDiff(["{", '  "answer": "Lima"', "}"], ["{", '  "answer": "unknown"', "}"])).toEqual([
      { kind: "same", text: "{" },
      { kind: "removed", text: '  "answer": "Lima"' },
      { kind: "added", text: '  "answer": "unknown"' },
      { kind: "same", text: "}" },
    ]);
    expect(lineDiff([], ["a"])).toEqual([{ kind: "added", text: "a" }]);
  });
});

describe("improved and regressed counts beside each metric", () => {
  afterEach(cleanup);

  test("a paired metric shows both counts and clicking one asks for the filter", () => {
    const onFilter = mock(() => {});
    render(<MetricComparisonTable metrics={metrics} onFilter={onFilter} />);
    const [paired, unpaired] = screen.getAllByTestId("metric-row");
    fireEvent.click(within(paired!).getByRole("button", { name: /1 regressed/ }));
    expect(onFilter).toHaveBeenCalledWith({ metric: "exact_match", direction: "regressed" });
    expect(within(paired!).getByRole("button", { name: /1 improved/ })).toBeTruthy();
    expect(within(unpaired!).queryByRole("button")).toBeNull();
  });

  test("the case table follows the metric filter and the chip clears it", () => {
    const onClear = mock(() => {});
    render(
      <CompareCasesTable
        cases={cases}
        loadCase={loadCase}
        metricFilter={{ metric: "set_f1", direction: "improved" }}
        onClearMetricFilter={onClear}
      />,
    );
    expect(screen.getAllByTestId("compare-case-row").map((row) => row.getAttribute("data-input-hash"))).toEqual(["a"]);
    fireEvent.click(screen.getByRole("button", { name: /Clear filter set F1 improved/ }));
    expect(onClear).toHaveBeenCalled();
  });

  test("the gate shows the counts with links to the filtered comparison", () => {
    render(
      <GateChanges
        slug="t"
        before="x"
        after="y"
        changes={[
          { name: "score", improved: 10, regressed: 3 },
          { name: "set_f1", improved: 8, regressed: 0 },
        ]}
      />,
    );
    const rows = screen.getAllByTestId("gate-change");
    expect(rows.map((row) => row.getAttribute("data-metric"))).toEqual(["score", "set_f1"]);
    const regressed = within(rows[0]!).getByRole("link", { name: /3 regressed/ });
    expect(regressed.getAttribute("href")).toBe("/tasks/t/evals/compare?before=x&after=y&metric=score&change=regressed");
    expect(within(rows[1]!).queryByRole("link", { name: /0 regressed/ })).toBeNull();
    expect(rows[1]!.textContent).toContain("0 regressed");
  });
});

describe("stacked rows and the expected-against-output diff", () => {
  afterEach(cleanup);

  test("the stacked view shows baseline and candidate on two lines per case", () => {
    render(<CompareCasesTable cases={cases} loadCase={loadCase} />);
    expect(screen.queryAllByTestId("stacked-line")).toHaveLength(0);
    fireEvent.click(screen.getByRole("radio", { name: "Stacked" }));
    const first = screen.getAllByTestId("compare-case-row")[0]!;
    const lines = within(first).getAllByTestId("stacked-line");
    expect(lines.map((line) => line.getAttribute("data-side"))).toEqual(["before", "after"]);
    expect(lines[0]!.textContent).toContain("before");
    expect(lines[1]!.textContent).toContain("after");
    expect(first.textContent).toContain("-1");
  });

  test("the case panel diffs the expected answer against an output line by line", async () => {
    render(<CaseDiff inputHash="a" before={1} after={0} load={loadCase} />);
    await waitFor(() => screen.getByTestId("case-diff"));
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Expected vs output" }));
    fireEvent.click(screen.getByRole("tab", { name: "Expected vs output" }));
    const diff = await waitFor(() => screen.getByTestId("line-diff"));
    const removed = within(diff).getAllByTestId("line-removed");
    const added = within(diff).getAllByTestId("line-added");
    expect(removed[0]!.textContent).toContain("Lima");
    expect(added[0]!.textContent).toContain("unknown");
    fireEvent.click(within(screen.getByTestId("line-diff-side")).getByRole("radio", { name: "Before" }));
    expect(within(screen.getByTestId("line-diff")).queryAllByTestId("line-added")).toHaveLength(0);
  });
});

describe("api client", () => {
  test("parses per-case metric pairs, counts and gate changes, with defaults for older APIs", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("gates")) {
        return new Response(
          JSON.stringify({
            gates: [
              { id: "g", taskSlug: "t", createdAt: "x", passed: true, checks: [], changes: [{ name: "score", improved: 1, regressed: 2 }] },
              { id: "h", taskSlug: "t", createdAt: "x", passed: true, checks: [] },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          before: {},
          after: {},
          difference: 0,
          low: 0,
          high: 0,
          verdict: "better",
          fixed: 0,
          broken: 0,
          metrics: [{ ...metrics[0], improved: undefined, regressed: undefined }],
          cases: [{ inputHash: "a", before: 1, after: 0 }, cases[0]],
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const api = createApiClient({ baseUrl: "http://api.test", fetchImpl });
    const comparison = await api.compareEvalRuns("x", "y");
    expect(comparison.cases[0]!.metrics).toEqual({});
    expect(comparison.cases[1]!.metrics?.set_f1).toEqual({ before: 0.5, after: 0.75 });
    expect(comparison.metrics[0]!.improved).toBeNull();
    const gates = await api.listGates("t");
    expect(gates[0]!.changes).toEqual([{ name: "score", improved: 1, regressed: 2 }]);
    expect(gates[1]!.changes).toBeNull();
  });
});
