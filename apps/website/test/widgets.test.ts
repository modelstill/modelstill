import { describe, expect, test } from "bun:test";
import {
  costSplit,
  deferralShare,
  gateOutcomes,
  hourlyCells,
  latencyTrend,
  modeCounts,
  passRateTrend,
  reviewProgress,
  splitWindows,
  taskGateStates,
} from "../src/lib/widgets";

const hour = (h: number) => new Date(Date.UTC(2026, 10, 20, h)).toISOString();
const bucket = (h: number, total: number, deferred: number, p95: number | null = null) => ({
  hour: hour(h),
  total,
  served_student: total - deferred,
  deferred,
  model_mismatch: 0,
  p95_student_ms: p95,
  p95_cloud_ms: null,
});

describe("pass rate trend", () => {
  test("orders runs oldest first and keeps the newest twelve", () => {
    const runs = Array.from({ length: 14 }, (_, index) => ({ id: String(index), createdAt: hour(index), mean: index / 20 }));
    const trend = passRateTrend([...runs].reverse());
    expect(trend.values).toHaveLength(12);
    expect(trend.values[0]).toBe(0.1);
    expect(trend.latest).toBe(0.65);
    expect(trend.previous).toBe(0.6);
  });

  test("a single run has no previous value", () => {
    expect(passRateTrend([{ createdAt: hour(1), mean: 0.7 }])).toMatchObject({ latest: 0.7, previous: null });
    expect(passRateTrend([])).toMatchObject({ latest: null, previous: null, values: [] });
  });
});

describe("traffic windows", () => {
  const buckets = [bucket(0, 10, 5), bucket(1, 10, 1), bucket(2, 20, 2), bucket(3, 20, 4)];

  test("the current window is the newest hours and the previous one the hours before", () => {
    const { current, previous } = splitWindows(buckets, 2);
    expect(current.map((entry) => entry.hour)).toEqual([hour(2), hour(3)]);
    expect(previous.map((entry) => entry.hour)).toEqual([hour(0), hour(1)]);
  });

  test("the deferral share is deferred over total and missing without traffic", () => {
    expect(deferralShare([bucket(0, 10, 5), bucket(1, 30, 5)])).toBe(0.25);
    expect(deferralShare([])).toBeNull();
  });

  test("hourly cells cover each hour of the window, empty where nothing was logged", () => {
    expect(hourlyCells([bucket(1, 10, 3), bucket(3, 4, 1)], 4, (entry) => entry.deferred)).toEqual([null, 3, null, 1]);
  });

  test("latency keeps the logged hours and compares the newest with the mean before it", () => {
    const trend = latencyTrend([bucket(0, 1, 0, 100), bucket(1, 1, 0, null), bucket(2, 1, 0, 300), bucket(3, 1, 0, 150)], 12);
    expect(trend.values).toEqual([100, 300, 150]);
    expect(trend.latest).toBe(150);
    expect(trend.previous).toBe(200);
  });
});

describe("cost, review and gates", () => {
  test("cost splits into the student and cloud parts", () => {
    const split = costSplit([
      { studentCostUsd: 0.001, cloudCostUsd: null },
      { studentCostUsd: 0.002, cloudCostUsd: 0.01 },
    ]);
    expect(split.student).toBeCloseTo(0.003);
    expect(split.cloud).toBeCloseTo(0.01);
    expect(split.total).toBeCloseTo(0.013);
    expect(split.count).toBe(2);
  });

  test("review progress counts decided items", () => {
    expect(reviewProgress([{ reviewState: "pending" }, { reviewState: "accepted" }, { reviewState: "corrected" }, { reviewState: "queued" }])).toEqual({
      decided: 2,
      total: 4,
      fraction: 0.5,
    });
    expect(reviewProgress([])).toEqual({ decided: 0, total: 0, fraction: 0 });
  });

  test("gate outcomes count passes and failures", () => {
    expect(gateOutcomes([{ passed: true }, { passed: false }, { passed: true }])).toEqual({ passed: 2, failed: 1 });
  });

  test("tasks split by their latest gate and by mode", () => {
    const tasks = [
      { lastGatePassed: true, mode: "serve" as const },
      { lastGatePassed: false, mode: "shadow" as const },
      { lastGatePassed: null, mode: "shadow" as const },
    ];
    expect(taskGateStates(tasks)).toEqual({ passed: 1, failed: 1, none: 1 });
    expect(modeCounts(tasks)).toEqual({ serve: 1, shadow: 2, off: 0 });
  });
});
