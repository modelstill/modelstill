export type TrafficBucket = {
  hour: string;
  total: number;
  served_student: number;
  deferred: number;
  model_mismatch: number;
  p95_student_ms: number | null;
  p95_cloud_ms: number | null;
};

export type TrafficStore = {
  hourly: (slug: string, hours: number) => Promise<TrafficBucket[]>;
};

export const noTraffic: TrafficStore = { hourly: async () => [] };

export function deferralShare(buckets: readonly TrafficBucket[]): number | null {
  const total = buckets.reduce((sum, bucket) => sum + bucket.total, 0);
  if (total === 0) return null;
  return buckets.reduce((sum, bucket) => sum + bucket.deferred, 0) / total;
}
