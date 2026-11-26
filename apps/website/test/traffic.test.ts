import { describe, expect, test } from "bun:test";
import { trafficRows, trafficTotals } from "../src/lib/traffic";

const buckets = [
  { hour: "2026-11-20T10:00:00Z", total: 10, served_student: 8, deferred: 2, model_mismatch: 1, p95_student_ms: 120, p95_cloud_ms: 900 },
  { hour: "2026-11-20T09:00:00Z", total: 5, served_student: 5, deferred: 0, model_mismatch: 0, p95_student_ms: 100, p95_cloud_ms: null },
];

describe("traffic rows", () => {
  test("sorts buckets by hour and labels them", () => {
    const rows = trafficRows(buckets);
    expect(rows.map((r) => r.label)).toEqual(["11-20 09:00", "11-20 10:00"]);
    expect(rows[1]).toMatchObject({ total: 10, student: 8, deferred: 2, mismatch: 1, p95Student: 120, p95Cloud: 900 });
    expect(rows[0]!.p95Cloud).toBeNull();
  });

  test("totals add up the window", () => {
    expect(trafficTotals(buckets)).toEqual({ total: 15, student: 13, deferred: 2, mismatch: 1 });
  });
});
