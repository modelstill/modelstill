export const task = {
  slug: "technographics",
  version: 3,
  snapshotHash: "abc123",
  mode: "shadow",
  deferralShare: 0.12,
  lastGatePassed: true,
};

export const version = { id: "v-3", version: 3, snapshotHash: "abc123", gitSha: "deadbeef", createdAt: "2026-11-20T10:00:00.000Z" };

export function evalRun(id: string, mean: number) {
  return {
    id,
    createdAt: "2026-11-20T10:00:00.000Z",
    model: `model-${id}`,
    split: "gold",
    judgeModel: "judge",
    mean,
    low: mean - 0.05,
    high: mean + 0.05,
    cases: 300,
    metrics: { f1: { value: mean, low: mean - 0.05, high: mean + 0.05 } },
    primaryMetric: "f1",
    benchmark: null,
  };
}

export const gate = {
  id: "g-1",
  taskSlug: "technographics",
  createdAt: "2026-11-21T10:00:00.000Z",
  passed: false,
  checks: [
    { name: "agreement_low", threshold: 0.8, value: 0.83, passed: true },
    { name: "regression", threshold: 0, value: -0.02, passed: false },
  ],
};

export const comparison = {
  before: evalRun("r1", 0.8),
  after: evalRun("r2", 0.85),
  difference: 0.05,
  low: 0.01,
  high: 0.09,
  verdict: "better",
  fixed: 20,
  broken: 5,
  cases: [
    { inputHash: "h1", before: 0, after: 1 },
    { inputHash: "h2", before: 1, after: 1 },
  ],
};

export const reviewItem = {
  id: "item-1",
  inputHash: "h1",
  input: { text: "hello" },
  teacherOutputs: [{ label: "a" }, { label: "b" }],
  agreement: false,
  reviewState: "queued",
};

export const deployment = {
  mode: "shadow",
  studentModel: "student-v3",
  threshold: 0.7,
  targetError: 0.05,
  shadowSample: 0.1,
  activeFrom: "2026-11-20T10:00:00.000Z",
};

export const trafficBuckets = [
  { hour: "2026-11-24T10:00:00.000Z", total: 100, served_student: 80, deferred: 20, model_mismatch: 1, p95_student_ms: 120, p95_cloud_ms: 900 },
  { hour: "2026-11-24T11:00:00.000Z", total: 50, served_student: 45, deferred: 5, model_mismatch: 0, p95_student_ms: 110, p95_cloud_ms: null },
];

export const canary = { createdAt: "2026-11-24T10:00:00.000Z", provider: "openai", passed: 19, total: 20, low: 0.75, high: 0.99 };

export const alert = { id: "a-1", kind: "drift", severity: "warning", createdAt: "2026-11-24T10:00:00.000Z", ackedAt: null, payload: { psi: 0.3 } };

export const trainRun = {
  key: "run-1",
  taskSlug: "technographics",
  base: "qwen3-4b",
  method: "sft",
  status: "succeeded",
  manifest: null,
  attestation: null,
  finalMetrics: { eval_loss: 0.4 },
  startedAt: "2026-11-23T10:00:00.000Z",
  finishedAt: "2026-11-23T12:00:00.000Z",
};

export const trainSeries = {
  eval_loss: [
    { step: 100, epoch: 0.5, value: 0.9 },
    { step: 200, epoch: 1, value: 0.35 },
    { step: 300, epoch: 1.5, value: 0.4 },
  ],
  eval_reward: [
    { step: 100, epoch: 0.5, value: 0.2 },
    { step: 200, epoch: 1, value: 0.6 },
    { step: 300, epoch: 1.5, value: 0.55 },
  ],
  learning_rate: [{ step: 100, epoch: 0.5, value: 0.0002 }],
};
