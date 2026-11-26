import type { TrainMetricPoint, TrainRun, TrainRunUpsert, TrainSeriesPoint } from "./store.ts";

function utc(value: string | undefined): string | undefined {
  return value === undefined ? undefined : new Date(value).toISOString();
}

export function mergeTrainRun(
  slug: string,
  key: string,
  input: TrainRunUpsert,
  existing: TrainRun | null,
  now: Date = new Date(),
): TrainRun {
  const finished = input.status !== "running";
  return {
    key,
    taskSlug: slug,
    base: input.base,
    method: input.method,
    status: input.status,
    manifest: input.manifest ?? existing?.manifest ?? null,
    attestation: input.attestation ?? existing?.attestation ?? null,
    finalMetrics: input.finalMetrics ?? existing?.finalMetrics ?? null,
    startedAt: utc(input.startedAt) ?? existing?.startedAt ?? now.toISOString(),
    finishedAt: utc(input.finishedAt) ?? (finished ? (existing?.finishedAt ?? now.toISOString()) : null),
  };
}

export function lastPerStepAndName(points: readonly TrainMetricPoint[]): TrainMetricPoint[] {
  return [...new Map(points.map((point) => [`${point.step}\u0000${point.name}`, point])).values()];
}

export function groupSeries(points: readonly TrainMetricPoint[]): Record<string, TrainSeriesPoint[]> {
  const series: Record<string, TrainSeriesPoint[]> = {};
  const ordered = [...points].sort((left, right) => left.name.localeCompare(right.name) || left.step - right.step);
  for (const { name, step, epoch, value } of ordered) (series[name] ??= []).push({ step, epoch, value });
  return series;
}

export function newestStartedFirst(runs: readonly TrainRun[]): TrainRun[] {
  return [...runs].sort((left, right) => right.startedAt.localeCompare(left.startedAt) || left.key.localeCompare(right.key));
}
