import type { StepRow, StepSeries } from "@modelstill/ui/blocks/step-chart";
import type { TrainRun, TrainSeries } from "./api";

export const LIVE_REFRESH_MS = 10_000;

export type MetricChart = {
  title: string;
  description: string;
  series: StepSeries[];
  rows: StepRow[];
  latest: number | null;
};

type ChartSpec = { title: string; description: string; name: string; label: string; always: boolean };

const CHARTS: ChartSpec[] = [
  { title: "Train loss", description: "loss logged while training", name: "loss", label: "Train loss", always: true },
  { title: "Eval loss", description: "loss on the validation split", name: "eval_loss", label: "Eval loss", always: true },
  { title: "Eval reward", description: "mean task reward on the validation split", name: "eval_reward", label: "Eval reward", always: true },
  { title: "Learning rate", description: "scheduler value at each logged step", name: "learning_rate", label: "Learning rate", always: false },
  { title: "Gradient norm", description: "before clipping", name: "grad_norm", label: "Grad norm", always: false },
];

export function stepRows(series: TrainSeries, names: readonly string[]): StepRow[] {
  const rows = new Map<number, StepRow>();
  for (const name of names) {
    for (const point of series[name] ?? []) {
      const row = rows.get(point.step) ?? ({ step: point.step, ...Object.fromEntries(names.map((key) => [key, null])) } as StepRow);
      row[name] = point.value;
      rows.set(point.step, row);
    }
  }
  return [...rows.values()].sort((left, right) => left.step - right.step);
}

export function latestValue(series: TrainSeries, name: string): number | null {
  const points = series[name] ?? [];
  return points.length === 0 ? null : points.reduce((last, point) => (point.step >= last.step ? point : last)).value;
}

export function metricCharts(series: TrainSeries): MetricChart[] {
  return CHARTS.filter((spec) => spec.always || (series[spec.name]?.length ?? 0) > 0).map((spec) => ({
    title: spec.title,
    description: spec.description,
    series: [{ key: spec.name, label: spec.label }],
    rows: stepRows(series, [spec.name]),
    latest: latestValue(series, spec.name),
  }));
}

export function runMetric(run: TrainRun, name: string, series?: TrainSeries): number | null {
  return run.finalMetrics?.[name] ?? (series ? latestValue(series, name) : null);
}

export function formatMetric(value: number | null): string {
  if (value === null) return "n/a";
  const magnitude = Math.abs(value);
  if (value !== 0 && (magnitude < 0.001 || magnitude >= 100_000)) return value.toExponential(3);
  return Number(value.toPrecision(4)).toString();
}

export function latestStep(series: TrainSeries): number | null {
  const steps = Object.values(series).flatMap((points) => points.map((point) => point.step));
  return steps.length === 0 ? null : Math.max(...steps);
}
