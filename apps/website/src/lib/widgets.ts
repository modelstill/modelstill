import type { Mode, TrafficBucket } from "./api";
import { isWaiting } from "./review";

const HOUR_MS = 3_600_000;
const TREND_LENGTH = 12;

export type Trend = { values: number[]; latest: number | null; previous: number | null };

export function passRateTrend(runs: readonly { createdAt: string; mean: number }[]): Trend {
  const ordered = [...runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((run) => run.mean);
  return {
    values: ordered.slice(-TREND_LENGTH),
    latest: ordered.at(-1) ?? null,
    previous: ordered.length > 1 ? ordered.at(-2)! : null,
  };
}

function hourOf(entry: { hour: string }): number {
  return Date.parse(entry.hour);
}

function newestHour(buckets: readonly { hour: string }[]): number | null {
  return buckets.length === 0 ? null : Math.max(...buckets.map(hourOf));
}

export function splitWindows<T extends { hour: string }>(buckets: readonly T[], hours: number): { current: T[]; previous: T[] } {
  const newest = newestHour(buckets);
  if (newest === null) return { current: [], previous: [] };
  const start = newest - (hours - 1) * HOUR_MS;
  const sorted = [...buckets].sort((a, b) => hourOf(a) - hourOf(b));
  return {
    current: sorted.filter((entry) => hourOf(entry) >= start),
    previous: sorted.filter((entry) => hourOf(entry) < start && hourOf(entry) >= start - hours * HOUR_MS),
  };
}

export function deferralShare(buckets: readonly Pick<TrafficBucket, "total" | "deferred">[]): number | null {
  const total = buckets.reduce((sum, entry) => sum + entry.total, 0);
  if (total === 0) return null;
  return buckets.reduce((sum, entry) => sum + entry.deferred, 0) / total;
}

export function hourlyCells<T extends { hour: string }>(buckets: readonly T[], hours: number, value: (bucket: T) => number): (number | null)[] {
  const newest = newestHour(buckets);
  if (newest === null) return [];
  const byHour = new Map(buckets.map((entry) => [hourOf(entry), entry]));
  return Array.from({ length: hours }, (_, index) => {
    const entry = byHour.get(newest - (hours - 1 - index) * HOUR_MS);
    return entry ? value(entry) : null;
  });
}

export function latencyTrend(buckets: readonly Pick<TrafficBucket, "hour" | "p95_student_ms">[], hours: number): Trend {
  const logged = [...buckets]
    .sort((a, b) => a.hour.localeCompare(b.hour))
    .map((entry) => entry.p95_student_ms)
    .filter((value): value is number => value !== null)
    .slice(-hours);
  const before = logged.slice(0, -1);
  return {
    values: logged,
    latest: logged.at(-1) ?? null,
    previous: before.length === 0 ? null : before.reduce((sum, value) => sum + value, 0) / before.length,
  };
}

export type CostSplit = { student: number; cloud: number; total: number; count: number };

export function costSplit(requests: readonly { studentCostUsd: number | null; cloudCostUsd: number | null }[]): CostSplit {
  const student = requests.reduce((sum, request) => sum + (request.studentCostUsd ?? 0), 0);
  const cloud = requests.reduce((sum, request) => sum + (request.cloudCostUsd ?? 0), 0);
  return { student, cloud, total: student + cloud, count: requests.length };
}

export function reviewProgress(items: readonly { reviewState: string }[]): { decided: number; total: number; fraction: number } {
  const decided = items.filter((item) => !isWaiting(item.reviewState)).length;
  return { decided, total: items.length, fraction: items.length === 0 ? 0 : decided / items.length };
}

export function gateOutcomes(gates: readonly { passed: boolean }[]): { passed: number; failed: number } {
  const passed = gates.filter((gate) => gate.passed).length;
  return { passed, failed: gates.length - passed };
}

export function taskGateStates(tasks: readonly { lastGatePassed: boolean | null }[]): { passed: number; failed: number; none: number } {
  return {
    passed: tasks.filter((task) => task.lastGatePassed === true).length,
    failed: tasks.filter((task) => task.lastGatePassed === false).length,
    none: tasks.filter((task) => task.lastGatePassed === null).length,
  };
}

export function modeCounts(tasks: readonly { mode: Mode }[]): Record<Mode, number> {
  return {
    serve: tasks.filter((task) => task.mode === "serve").length,
    shadow: tasks.filter((task) => task.mode === "shadow").length,
    off: tasks.filter((task) => task.mode === "off").length,
  };
}
