import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MetricHistogram } from "../src/components/evals/metric-histogram";
import { RunCasesTable } from "../src/components/evals/run-cases-table";
import { createApiClient, type RunCase } from "../src/lib/api";
import { breadcrumbs, evalRunHref } from "../src/lib/nav";
import { baselineFor, histogramRows, isUnitScore, pageLabel, previewText, scoreColumns } from "../src/lib/run-detail";

const cases: RunCase[] = [
  {
    inputHash: "sha256:aaaa1111",
    score: 0,
    input: { question: "What is the capital of Peru?" },
    output: { answer: "unknown" },
    expected: { answer: "Lima" },
    metrics: { exact_match: 0, set_f1: 0.25 },
  },
  {
    inputHash: "sha256:bbbb2222",
    score: 1,
    input: "Capital of Chile?",
    output: { answer: "Santiago" },
    expected: { answer: "Santiago" },
    metrics: { exact_match: 1 },
  },
];

describe("run detail helpers", () => {
  test("a preview is one short line of any value", () => {
    expect(previewText("What is   the\ncapital?")).toBe("What is the capital?");
    expect(previewText({ question: "Peru" })).toBe('{"question":"Peru"}');
    expect(previewText("a".repeat(100), 10)).toBe("aaaaaaaaa…");
    expect(previewText(null)).toBe("");
    expect(previewText(undefined)).toBe("");
    expect(previewText(3)).toBe("3");
  });

  test("score columns are the case score, then every metric any case logged", () => {
    expect(scoreColumns(cases)).toEqual(["score", "exact_match", "set_f1"]);
    expect(scoreColumns([])).toEqual(["score"]);
  });

  test("histogram rows label each bin by its range", () => {
    expect(histogramRows([{ low: 0, high: 0.1, count: 3 }, { low: 0.9, high: 1, count: 7 }])).toEqual([
      { range: "0–0.1", low: 0, high: 0.1, count: 3 },
      { range: "0.9–1", low: 0.9, high: 1, count: 7 },
    ]);
    expect(histogramRows([{ low: 3, high: 3, count: 2 }])[0]!.range).toBe("3");
  });

  test("the baseline is the newest older run on the same split", () => {
    const runs = [
      { id: "a", createdAt: "2026-11-01", split: "gold" },
      { id: "b", createdAt: "2026-11-03", split: "val" },
      { id: "c", createdAt: "2026-11-02", split: "gold" },
      { id: "d", createdAt: "2026-11-04", split: "gold" },
    ];
    expect(baselineFor(runs, "d")?.id).toBe("c");
    expect(baselineFor(runs, "c")?.id).toBe("a");
    expect(baselineFor(runs, "a")).toBeNull();
    expect(baselineFor(runs, "missing")).toBeNull();
  });

  test("the page label counts from one", () => {
    expect(pageLabel(0, 100, 240)).toBe("1–100 of 240");
    expect(pageLabel(200, 40, 240)).toBe("201–240 of 240");
    expect(pageLabel(0, 0, 0)).toBe("0 of 0");
  });

  test("a run page sits under evals, and compare keeps its own crumb", () => {
    expect(evalRunHref("t", "run 1")).toBe("/tasks/t/evals/run%201");
    expect(breadcrumbs("/tasks/t/evals/11111111-2222")).toEqual([
      { label: "Tasks", href: "/tasks" },
      { label: "t", href: "/tasks/t" },
      { label: "Evals", href: "/tasks/t/evals" },
      { label: "Run 11111111" },
    ]);
    expect(breadcrumbs("/tasks/t/evals/compare").at(-1)).toEqual({ label: "Compare" });
  });
});

describe("api client for one run", () => {
  test("reads the run with its histograms and a page of its cases", async () => {
    const urls: string[] = [];
    const run = {
      id: "r1",
      createdAt: "2026-11-24T00:00:00Z",
      model: "student",
      split: "gold",
      judgeModel: "",
      mean: 0.5,
      low: 0.2,
      high: 0.8,
      cases: 2,
      metrics: {},
      primaryMetric: null,
      benchmark: null,
    };
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      const body = url.includes("/cases")
        ? { total: 2, offset: 0, cases }
        : { run, histograms: [{ metric: "score", bins: [{ low: 0, high: 1, count: 2 }] }] };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    const api = createApiClient({ baseUrl: "http://api.test", fetchImpl });
    const detail = await api.getEvalRun("r1");
    expect(detail.run.id).toBe("r1");
    expect(detail.histograms[0]!.bins[0]!.count).toBe(2);
    const page = await api.listEvalCases("r1", { offset: 100, limit: 50 });
    expect(page.total).toBe(2);
    expect(page.cases[1]!.input).toBe("Capital of Chile?");
    expect(urls).toEqual(["http://api.test/v1/eval-runs/r1", "http://api.test/v1/eval-runs/r1/cases?offset=100&limit=50"]);
  });
});

describe("run cases table", () => {
  afterEach(cleanup);

  test("one row per case with previews and a column per metric", () => {
    render(<RunCasesTable cases={cases} />);
    const rows = screen.getAllByTestId("data-table-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("capital of Peru");
    expect(rows[0]!.textContent).toContain("unknown");
    expect(rows[0]!.textContent).toContain("Lima");
    const header = screen.getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(header).toEqual(expect.arrayContaining(["Case", "Input", "Output", "Expected", "case score", "exact match", "set F1"]));
    expect(rows[1]!.textContent).toContain("missing");
  });

  test("scores between zero and one get a banded meter", () => {
    render(<RunCasesTable cases={cases} />);
    const meters = screen.getAllByTestId("data-table-row")[0]!.querySelectorAll("[data-slot=segment-meter]");
    expect([...meters].map((meter) => meter.getAttribute("data-tone"))).toEqual(["warning", "warning", "warning"]);
  });

  test("a metric is a unit score only when every value is between zero and one", () => {
    expect(isUnitScore(cases, "set_f1")).toBe(true);
    expect(isUnitScore([{ ...cases[0]!, metrics: { tokens: 42 } }], "tokens")).toBe(false);
    expect(isUnitScore([], "score")).toBe(false);
  });

  test("opening a row shows the full input, output, expected answer and every score", async () => {
    render(<RunCasesTable cases={cases} />);
    fireEvent.click(screen.getAllByTestId("data-table-row")[0]!);
    const panel = await waitFor(() => screen.getByTestId("run-case-detail"));
    expect(within(panel).getByTestId("run-case-input").textContent).toContain("What is the capital of Peru?");
    expect(within(panel).getByTestId("run-case-output").textContent).toContain("unknown");
    expect(within(panel).getByTestId("run-case-expected").textContent).toContain("Lima");
    const scores = within(panel).getAllByTestId("run-case-score");
    expect(scores.map((row) => row.getAttribute("data-metric"))).toEqual(["score", "exact_match", "set_f1"]);
    expect(scores[2]!.textContent).toContain("0.250");
  });
});

describe("metric histogram", () => {
  afterEach(cleanup);

  test("names the metric and counts the cases", () => {
    render(<MetricHistogram metric="set_f1" bins={[{ low: 0, high: 0.5, count: 3 }, { low: 0.5, high: 1, count: 5 }]} />);
    const card = screen.getByTestId("metric-histogram");
    expect(card.getAttribute("data-metric")).toBe("set_f1");
    expect(card.textContent).toContain("set F1");
    expect(card.textContent).toContain("8 cases");
  });
});
