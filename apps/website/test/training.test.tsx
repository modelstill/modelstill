import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { TrainStatusBadge } from "../src/components/badges";
import { TrainRunsTable } from "../src/components/training/train-runs-table";
import type { TrainRun } from "../src/lib/api";
import { formatMetric, metricCharts, runMetric, stepRows } from "../src/lib/training";

const run: TrainRun = {
  key: "t-9256c08a-a41fcbab-s1",
  taskSlug: "t",
  base: "Qwen/Qwen3-4B",
  method: "lora",
  status: "succeeded",
  manifest: null,
  attestation: null,
  finalMetrics: { eval_loss: 0.4213, train_loss: 0.51 },
  startedAt: "2026-11-24T08:00:00.000Z",
  finishedAt: "2026-11-24T09:00:00.000Z",
};

const series = {
  loss: [
    { step: 10, epoch: 0.1, value: 1.4 },
    { step: 20, epoch: 0.2, value: 1.1 },
  ],
  eval_loss: [{ step: 20, epoch: 0.2, value: 0.9 }],
  learning_rate: [{ step: 10, epoch: 0.1, value: 0.0002 }],
};

describe("step rows", () => {
  test("merge series by step, in step order, with gaps as null", () => {
    expect(stepRows(series, ["loss", "eval_loss"])).toEqual([
      { step: 10, loss: 1.4, eval_loss: null },
      { step: 20, loss: 1.1, eval_loss: 0.9 },
    ]);
  });

  test("a series that was never logged gives no rows", () => {
    expect(stepRows(series, ["eval_reward"])).toEqual([]);
  });
});

describe("metric charts", () => {
  test("always offer train loss, eval loss and eval reward, and extras only when logged", () => {
    const charts = metricCharts(series);
    expect(charts.map((chart) => chart.title)).toEqual(["Train loss", "Eval loss", "Eval reward", "Learning rate"]);
    expect(charts.find((chart) => chart.title === "Eval reward")!.rows).toEqual([]);
    expect(charts[0]!.latest).toBe(1.1);
  });
});

describe("run metrics", () => {
  test("a finished run shows its final metric, a running one its latest logged value", () => {
    expect(runMetric(run, "eval_loss")).toBe(0.4213);
    expect(runMetric(run, "eval_reward")).toBeNull();
    expect(runMetric({ ...run, finalMetrics: null }, "eval_loss", series)).toBe(0.9);
  });

  test("format with four significant digits", () => {
    expect(formatMetric(0.421349)).toBe("0.4213");
    expect(formatMetric(0.0002)).toBe("2.000e-4");
    expect(formatMetric(null)).toBe("n/a");
  });
});

describe("training components", () => {
  afterEach(cleanup);

  test("status badges use a variant per status", () => {
    render(
      <>
        <TrainStatusBadge status="running" />
        <TrainStatusBadge status="succeeded" />
        <TrainStatusBadge status="failed" />
      </>,
    );
    const variant = (text: string) => screen.getByText(text).closest("[data-slot=badge]")?.getAttribute("data-variant");
    expect(variant("running")).toBe("info");
    expect(variant("succeeded")).toBe("success");
    expect(variant("failed")).toBe("danger");
  });

  test("the runs table shows status, method, base, final metrics and links to the run", () => {
    render(<TrainRunsTable slug="t" runs={[run]} />);
    expect(screen.getByText("succeeded")).toBeTruthy();
    expect(screen.getByText("lora")).toBeTruthy();
    expect(screen.getByText("Qwen/Qwen3-4B")).toBeTruthy();
    expect(screen.getByText("0.4213")).toBeTruthy();
    const link = screen.getByRole("link", { name: run.key });
    expect(link.getAttribute("href")).toBe("/tasks/t/training/t-9256c08a-a41fcbab-s1");
  });
});
