import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ComparisonSummary } from "@modelstill/ui/blocks/comparison-summary";
import { GateChecks, thresholdLabel } from "@modelstill/ui/blocks/gate-checks";
import { IntervalValue } from "@modelstill/ui/blocks/interval-value";
import { ModeBadge } from "@modelstill/ui/blocks/mode-badge";
import { diffTeacherOutputs, TeacherDiff } from "@modelstill/ui/blocks/teacher-diff";
import { PassBadge, VerdictBadge } from "@modelstill/ui/blocks/verdict-badge";

afterEach(cleanup);

describe("IntervalValue", () => {
  test("shows the mean with its interval and a bar", () => {
    render(<IntervalValue mean={0.8312} low={0.7861} high={0.8649} />);
    expect(screen.getByText("0.83 [0.79, 0.86]")).toBeTruthy();
    expect(screen.getByTestId("interval-bar")).toBeTruthy();
  });

  test("a signed value keeps its sign and marks zero inside the domain", () => {
    render(<IntervalValue mean={0.04} low={-0.01} high={0.09} signed domain={{ min: -0.2, max: 0.2 }} />);
    expect(screen.getByText("+0.04 [-0.01, +0.09]")).toBeTruthy();
    expect(screen.getByTestId("interval-zero")).toBeTruthy();
  });

  test("a comparison marker is drawn at its position", () => {
    render(<IntervalValue mean={0.5} low={0.4} high={0.6} compare={0.75} />);
    expect(screen.getByTestId("interval-compare").style.left).toBe("75%");
  });

  test("a missing estimate says n/a and draws no bar", () => {
    render(<IntervalValue mean={null} low={null} high={null} />);
    expect(screen.getByText("n/a")).toBeTruthy();
    expect(screen.queryByTestId("interval-bar")).toBeNull();
  });

  test("percent format shows shares", () => {
    render(<IntervalValue mean={0.5} low={0.25} high={0.75} format="percent" bar={false} />);
    expect(screen.getByText("50.0% [25.0%, 75.0%]")).toBeTruthy();
  });
});

describe("VerdictBadge and ModeBadge", () => {
  test("each verdict has a readable label and tone", () => {
    render(
      <>
        <VerdictBadge verdict="better" />
        <VerdictBadge verdict="worse" />
        <VerdictBadge verdict="no_detectable_difference" />
      </>,
    );
    expect(screen.getByText("better").closest("[data-slot=badge]")?.getAttribute("data-variant")).toBe("success");
    expect(screen.getByText("worse").closest("[data-slot=badge]")?.getAttribute("data-variant")).toBe("danger");
    expect(screen.getByText("no detectable difference")).toBeTruthy();
    for (const label of ["better", "worse", "no detectable difference"]) {
      expect(screen.getByText(label).closest("[data-slot=badge]")!.querySelector("svg")).toBeTruthy();
    }
  });

  test("pass and fail badges carry an icon and a label", () => {
    render(
      <>
        <PassBadge passed />
        <PassBadge passed={false} />
        <PassBadge passed={null} />
      </>,
    );
    for (const label of ["pass", "fail", "no gate yet"]) {
      expect(screen.getByText(label).closest("[data-slot=badge]")!.querySelector("svg")).toBeTruthy();
    }
  });

  test("modes map to distinct variants", () => {
    render(
      <>
        <ModeBadge mode="off" />
        <ModeBadge mode="shadow" />
        <ModeBadge mode="serve" />
      </>,
    );
    const variant = (text: string) => screen.getByText(text).closest("[data-slot=badge]")?.getAttribute("data-variant");
    expect([variant("off"), variant("shadow"), variant("serve")]).toEqual(["outline", "info", "success"]);
  });
});

describe("GateChecks", () => {
  const checks = [
    { name: "accuracy_low", threshold: 0.8, value: 0.8312, passed: true },
    { name: "latency_p95_ms", threshold: 300, value: 412, passed: false },
    { name: "coverage", threshold: null, value: null, passed: true },
  ];

  test("lists every check with threshold, value and result", () => {
    render(<GateChecks checks={checks} />);
    const rows = screen.getAllByTestId("gate-check");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText("0.8312")).toBeTruthy();
    expect(within(rows[1]!).getByText("fail")).toBeTruthy();
    expect(within(rows[2]!).getAllByText("n/a")).toHaveLength(2);
  });

  test("summarises how many checks failed", () => {
    render(<GateChecks checks={checks} />);
    expect(screen.getByText("3 checks, 1 failed")).toBeTruthy();
  });

  test("a check read from an estimate shows the estimate with its interval", () => {
    render(
      <GateChecks
        checks={[{ name: "regression_vs_baseline", threshold: -0.02, value: -0.043, passed: false, estimate: -0.026, low: -0.043, high: -0.009, measured: true, reason: null }]}
      />,
    );
    const row = screen.getByTestId("gate-check");
    expect(within(row).getByText("-0.026 [-0.043, -0.009]")).toBeTruthy();
    expect(within(row).getByText("at least -0.02")).toBeTruthy();
  });

  test("an unmeasured check is marked, keeps its fail badge and says why", () => {
    render(
      <GateChecks
        checks={[{ name: "flip_rate", threshold: 0.01, value: 1, passed: false, estimate: null, low: null, high: null, measured: false, reason: "Not measured, so it was recorded at its failing worst-case value." }]}
      />,
    );
    const row = screen.getByTestId("gate-check");
    expect(row.getAttribute("data-measured")).toBe("false");
    expect(within(row).getByText("at most 0.01")).toBeTruthy();
    expect(within(row).getByText("not measured").closest("[data-slot=badge]")!.querySelector("svg")).toBeTruthy();
    expect(within(row).getByText("fail").closest("[data-slot=badge]")!.querySelector("svg")).toBeTruthy();
    expect(within(row).getByTestId("gate-check-reason").textContent).toContain("worst-case");
    expect(screen.getByText("1 checks, 1 failed, 1 not measured")).toBeTruthy();
  });

  test("the threshold direction is read from the result when the name is unknown", () => {
    expect(thresholdLabel({ name: "kappa", threshold: 0.6, value: 0.7, passed: true })).toBe("at least 0.6");
    expect(thresholdLabel({ name: "kappa", threshold: 0.6, value: 0.7, passed: false })).toBe("at most 0.6");
    expect(thresholdLabel({ name: "kappa", threshold: 0.6, value: 0.6, passed: true })).toBe("0.6");
    expect(thresholdLabel({ name: "coverage", threshold: null, value: null, passed: true })).toBe("n/a");
  });

  test("an empty gate says it stored no checks", () => {
    render(<GateChecks checks={[]} />);
    expect(screen.getByText("This gate stored no checks.")).toBeTruthy();
  });
});

describe("ComparisonSummary", () => {
  test("shows the difference with its interval, the verdict and the fixed and broken counts", () => {
    render(<ComparisonSummary difference={0.04} low={-0.01} high={0.09} verdict="no_detectable_difference" fixed={7} broken={3} />);
    expect(screen.getByText("+0.04 [-0.01, +0.09]")).toBeTruthy();
    expect(screen.getByText("no detectable difference")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });
});

describe("TeacherDiff", () => {
  const outputs = [
    { teacher: "teacher-a", output: { title: "Senior Engineer", level: 3 } },
    { teacher: "teacher-b", output: { title: "Software Engineer", level: 3 } },
  ];

  test("diffTeacherOutputs marks the paths where teachers disagree", () => {
    expect(diffTeacherOutputs(outputs)).toEqual([
      { path: "level", values: [3, 3], differs: false },
      { path: "title", values: ["Senior Engineer", "Software Engineer"], differs: true },
    ]);
  });

  test("scalar outputs compare as a single value", () => {
    expect(diffTeacherOutputs([{ teacher: "a", output: "x" }, { teacher: "b", output: "y" }])).toEqual([
      { path: "value", values: ["x", "y"], differs: true },
    ]);
  });

  test("renders one column per teacher and highlights differing cells", () => {
    render(<TeacherDiff outputs={outputs} />);
    expect(screen.getByText("teacher-a")).toBeTruthy();
    expect(screen.getByText("teacher-b")).toBeTruthy();
    const differing = screen.getAllByTestId("teacher-diff-row").filter((row) => row.getAttribute("data-differs") === "true");
    expect(differing.map((row) => row.getAttribute("data-path"))).toEqual(["title"]);
    expect(screen.getByText("1 of 2 fields differ")).toBeTruthy();
  });

  test("list outputs read as comma-separated items", () => {
    render(<TeacherDiff outputs={[{ teacher: "a", output: ["snowflake", "spark"] }, { teacher: "b", output: ["spark"] }]} />);
    expect(screen.getByText("[snowflake, spark]")).toBeTruthy();
  });

  test("no outputs says so", () => {
    render(<TeacherDiff outputs={[]} />);
    expect(screen.getByText("No teacher outputs were logged for this item.")).toBeTruthy();
  });
});
