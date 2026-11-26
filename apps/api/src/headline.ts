import { summarizeScores } from "./stats.ts";
import type { Metric } from "./store.ts";

export type Headline = { mean: number; low: number; high: number };

const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export function canonicalUuid(value: string): string {
  if (!isUuid(value)) return value;
  const hex = value.replaceAll("-", "").toLowerCase();
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

export function primaryHeadline(metrics: Record<string, Metric>, primaryMetric: string | null): Headline | null {
  const metric = primaryMetric ? metrics[primaryMetric] : undefined;
  return metric ? { mean: metric.value, low: metric.low, high: metric.high } : null;
}

export function caseHeadline(scores: readonly number[]): Headline {
  if (scores.length === 0) return { mean: 0, low: 0, high: 0 };
  const { mean, low, high } = summarizeScores(scores);
  return { mean, low, high };
}
