import type { CaseScore } from "./stats.ts";

export const HISTOGRAM_BINS = 10;

export type HistogramBin = { low: number; high: number; count: number };

export type MetricHistogram = { metric: string; bins: HistogramBin[] };

function range(values: readonly number[]): [number, number] {
  const min = values.reduce((lowest, value) => Math.min(lowest, value), Infinity);
  const max = values.reduce((highest, value) => Math.max(highest, value), -Infinity);
  return min >= 0 && max <= 1 ? [0, 1] : [min, max];
}

export function histogram(values: readonly number[], size = HISTOGRAM_BINS): HistogramBin[] {
  if (values.length === 0) return [];
  const [min, max] = range(values);
  if (max === min) return [{ low: min, high: max, count: values.length }];
  const span = max - min;
  const bins = Array.from({ length: size }, (_, index) => ({
    low: min + (span * index) / size,
    high: min + (span * (index + 1)) / size,
    count: 0,
  }));
  for (const value of values) bins[Math.min(size - 1, Math.floor(((value - min) / span) * size))]!.count += 1;
  return bins;
}

function sharedMetricNames(scores: readonly CaseScore[]): string[] {
  const names = new Set(scores.flatMap((entry) => Object.keys(entry.metrics ?? {})));
  return [...names].filter((name) => scores.every((entry) => typeof entry.metrics?.[name] === "number")).sort();
}

export function histogramsFor(scores: readonly CaseScore[]): MetricHistogram[] {
  if (scores.length === 0) return [];
  return [
    { metric: "score", bins: histogram(scores.map((entry) => entry.score)) },
    ...sharedMetricNames(scores).map((metric) => ({ metric, bins: histogram(scores.map((entry) => entry.metrics![metric]!)) })),
  ];
}
