import * as z from "zod/v4";

export const ServingMode = z.enum(["off", "shadow", "serve"]);

export const taskArg = z.string().min(1).describe("The task slug, as list_tasks returns it.");

export function limitArg(max: number, fallback: number) {
  return z
    .number()
    .int()
    .min(1)
    .max(max)
    .optional()
    .describe(`How many to return, newest first. Default ${fallback}, at most ${max}.`);
}

export const TaskSummary = z.looseObject({
  slug: z.string(),
  version: z.number(),
  snapshotHash: z.string(),
  mode: z.string(),
  deferralShare: z.number().nullable(),
  lastGatePassed: z.boolean().nullable(),
});

export const TaskVersion = z.looseObject({
  id: z.string(),
  version: z.number(),
  snapshotHash: z.string(),
  gitSha: z.string(),
  createdAt: z.string(),
});

const Metric = z.looseObject({ value: z.number(), low: z.number(), high: z.number() });

export const EvalRun = z.looseObject({
  id: z.string(),
  createdAt: z.string(),
  model: z.string(),
  split: z.string(),
  judgeModel: z.string(),
  mean: z.number(),
  low: z.number(),
  high: z.number(),
  cases: z.number(),
  metrics: z.record(z.string(), Metric),
  primaryMetric: z.string().nullable(),
  benchmark: z.looseObject({ name: z.string(), version: z.string() }).nullable(),
});

export const GateRecord = z.looseObject({
  id: z.string(),
  taskSlug: z.string(),
  createdAt: z.string(),
  passed: z.boolean(),
  checks: z.array(z.looseObject({ name: z.string(), threshold: z.number(), value: z.number(), passed: z.boolean() })),
});

export const ReviewItem = z.looseObject({
  id: z.string(),
  inputHash: z.string(),
  input: z.unknown(),
  teacherOutputs: z.unknown(),
  agreement: z.boolean().nullable(),
  reviewState: z.string(),
});

export const Deployment = z.looseObject({
  mode: z.string(),
  studentModel: z.string().nullable(),
  threshold: z.number().nullable(),
  targetError: z.number(),
  shadowSample: z.number(),
  activeFrom: z.string(),
});

export const TrafficBucket = z.looseObject({
  hour: z.string(),
  total: z.number(),
  served_student: z.number(),
  deferred: z.number(),
  model_mismatch: z.number(),
  p95_student_ms: z.number().nullable(),
  p95_cloud_ms: z.number().nullable(),
});

export const CanaryRun = z.looseObject({
  createdAt: z.string(),
  provider: z.string(),
  passed: z.number(),
  total: z.number(),
  low: z.number(),
  high: z.number(),
});

export const Alert = z.looseObject({
  id: z.string(),
  kind: z.string(),
  severity: z.string(),
  createdAt: z.string(),
  ackedAt: z.string().nullable(),
  payload: z.unknown(),
});

export const TrainRun = z.looseObject({
  key: z.string(),
  taskSlug: z.string(),
  base: z.string(),
  method: z.string(),
  status: z.string(),
  manifest: z.unknown(),
  attestation: z.unknown(),
  finalMetrics: z.record(z.string(), z.number()).nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});

const SeriesPoint = z.object({ step: z.number(), value: z.number() });

export const SeriesSummary = z.object({
  points: z.number(),
  first: SeriesPoint,
  last: SeriesPoint,
  best: SeriesPoint.nullable(),
  better: z.enum(["lower", "higher"]).nullable(),
});

export function newest<T>(items: T[], limit: unknown, fallback: number): { items: T[]; total: number } {
  const count = typeof limit === "number" ? limit : fallback;
  return { items: items.slice(0, count), total: items.length };
}
