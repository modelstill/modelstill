import type { TrafficBucket } from "./api";
import { formatHour } from "./format";

export type TrafficRow = {
  hour: string;
  label: string;
  total: number;
  student: number;
  deferred: number;
  mismatch: number;
  p95Student: number | null;
  p95Cloud: number | null;
};

export function trafficRows(buckets: readonly TrafficBucket[]): TrafficRow[] {
  return [...buckets]
    .sort((a, b) => a.hour.localeCompare(b.hour))
    .map((bucket) => ({
      hour: bucket.hour,
      label: formatHour(bucket.hour),
      total: bucket.total,
      student: bucket.served_student,
      deferred: bucket.deferred,
      mismatch: bucket.model_mismatch,
      p95Student: bucket.p95_student_ms,
      p95Cloud: bucket.p95_cloud_ms,
    }));
}

export function trafficTotals(buckets: readonly TrafficBucket[]) {
  return buckets.reduce(
    (sum, bucket) => ({
      total: sum.total + bucket.total,
      student: sum.student + bucket.served_student,
      deferred: sum.deferred + bucket.deferred,
      mismatch: sum.mismatch + bucket.model_mismatch,
    }),
    { total: 0, student: 0, deferred: 0, mismatch: 0 },
  );
}
