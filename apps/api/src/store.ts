import type { CaseScore } from "./stats.ts";

export type ServingMode = "off" | "shadow" | "serve";

export type TaskSummary = {
  slug: string;
  version: number;
  snapshotHash: string;
  mode: ServingMode;
  deferralShare: number | null;
  lastGatePassed: boolean | null;
};

export type TaskVersion = {
  id: string;
  version: number;
  snapshotHash: string;
  gitSha: string;
  createdAt: string;
};

export type GateCheck = {
  name: string;
  threshold: number;
  value: number;
  passed: boolean;
  estimate?: number | null;
  low?: number | null;
  high?: number | null;
  measured?: boolean;
  reason?: string | null;
};

export type GateRecord = {
  id: string;
  taskSlug: string;
  createdAt: string;
  passed: boolean;
  checks: GateCheck[];
  evalRunId?: string | null;
  previousEvalRunId?: string | null;
  report?: unknown;
};

export type SplitName = "train" | "val" | "calib" | "gold";

export type Metric = { value: number; low: number; high: number };

export type BenchmarkRef = { name: string; version: string };

export type EvalRun = {
  id: string;
  createdAt: string;
  model: string;
  split: SplitName;
  judgeModel: string;
  mean: number;
  low: number;
  high: number;
  cases: number;
  metrics: Record<string, Metric>;
  primaryMetric: string | null;
  benchmark: BenchmarkRef | null;
};

export type EvalRunWithScores = { run: EvalRun; scores: CaseScore[] };

export type ReviewState = "none" | "queued" | "accepted" | "corrected";

export type ReviewItem = {
  id: string;
  inputHash: string;
  input: unknown;
  teacherOutputs: unknown;
  agreement: boolean | null;
  reviewState: ReviewState;
};

export type DatasetItem = ReviewItem & { finalOutput: unknown };

export type DatasetItemQuery = { state?: ReviewState; limit: number };

export type ReviewDecision =
  | { verdict: "accept"; reviewer: string }
  | { verdict: "correct"; reviewer: string; correctedOutput: unknown };

export type Deployment = {
  mode: ServingMode;
  studentModel: string | null;
  threshold: number | null;
  targetError: number;
  shadowSample: number;
  activeFrom: string;
};

export type CanaryRun = {
  createdAt: string;
  provider: string;
  passed: number;
  total: number;
  low: number;
  high: number;
};

export type Alert = {
  id: string;
  kind: string;
  severity: string;
  createdAt: string;
  ackedAt: string | null;
  payload: unknown;
};

export type CanaryRunCreate = CanaryRun & { id: string | null };

export type AlertCreate = Omit<Alert, "id" | "ackedAt"> & { id: string | null };

export type TaskUpsert = {
  version: number;
  snapshotHash: string;
  gitSha: string;
  spec: unknown;
  owner?: string;
};

export type PushedCase = {
  inputHash: string;
  score: number;
  output?: unknown;
  metrics?: Record<string, number>;
  input?: unknown;
  expected?: unknown;
};

export type CaseDetail = {
  inputHash: string;
  score: number;
  output: unknown;
  metrics: Record<string, number>;
  input: unknown;
  expected: unknown;
};

export type CasePage = { offset: number; limit: number };

export type EvalCasePage = { total: number; cases: CaseDetail[] };

export type EvalRunCreate = {
  id: string;
  createdAt: string;
  model: string;
  split: SplitName;
  judgeModel: string;
  benchmark: BenchmarkRef | null;
  metrics: Record<string, Metric>;
  primaryMetric: string | null;
  cases: PushedCase[];
};

export type GateCreate = {
  id: string;
  evalRunId: string;
  previousEvalRunId: string | null;
  passed: boolean;
  checks: GateCheck[];
  report: unknown;
};

export type ReviewItemUpsert = {
  inputHash: string;
  input?: unknown;
  teacherOutputs?: unknown;
  agreement: boolean | null;
  reviewState: ReviewState;
};

export type DeploymentUpdate = {
  mode: ServingMode;
  studentModel: string | null;
  threshold: number | null;
  targetError: number;
  shadowSample: number;
  activeFrom: string | null;
};

export type TrainStatus = "running" | "succeeded" | "failed";

export type TrainRun = {
  key: string;
  taskSlug: string;
  base: string;
  method: string;
  status: TrainStatus;
  manifest: unknown;
  attestation: unknown;
  finalMetrics: Record<string, number> | null;
  startedAt: string;
  finishedAt: string | null;
};

export type TrainRunUpsert = {
  base: string;
  method: string;
  status: TrainStatus;
  manifest?: unknown;
  attestation?: unknown;
  finalMetrics?: Record<string, number>;
  startedAt?: string;
  finishedAt?: string;
};

export type TrainMetricPoint = { step: number; epoch: number | null; name: string; value: number };

export type TrainSeriesPoint = { step: number; epoch: number | null; value: number };

export type TrainRunWithSeries = { run: TrainRun; series: Record<string, TrainSeriesPoint[]> };

export type TrainRunResult = TrainRun | "task_mismatch";

export type Created<T> = { value: T; created: boolean };

export type GateResult = Created<GateRecord> | "task_not_found" | "run_not_found";

export type Store = {
  listTasks: () => Promise<TaskSummary[]>;
  getTask: (slug: string) => Promise<TaskSummary | null>;
  listVersions: (slug: string) => Promise<TaskVersion[]>;
  listGates: (slug: string) => Promise<GateRecord[]>;
  listEvalRuns: (slug: string) => Promise<EvalRun[]>;
  getEvalRunWithScores: (id: string) => Promise<EvalRunWithScores | null>;
  getEvalCase: (runId: string, inputHash: string) => Promise<CaseDetail | null>;
  listEvalCases: (runId: string, page: CasePage) => Promise<EvalCasePage | null>;
  listReviewQueue: (slug: string, limit: number) => Promise<ReviewItem[]>;
  decideReview: (itemId: string, decision: ReviewDecision) => Promise<ReviewItem | null>;
  listDatasetItems: (slug: string, query: DatasetItemQuery) => Promise<DatasetItem[]>;
  getDeployment: (slug: string) => Promise<Deployment | null>;
  listCanaries: (slug: string) => Promise<CanaryRun[]>;
  listAlerts: (slug: string) => Promise<Alert[]>;
  upsertTask: (slug: string, input: TaskUpsert) => Promise<{ task: TaskSummary; version: TaskVersion }>;
  createEvalRun: (slug: string, input: EvalRunCreate) => Promise<Created<EvalRun> | null>;
  recordGate: (slug: string, input: GateCreate) => Promise<GateResult>;
  upsertReviewItems: (slug: string, items: ReviewItemUpsert[]) => Promise<number | null>;
  setDeployment: (slug: string, input: DeploymentUpdate) => Promise<Deployment | null>;
  recordCanaries: (slug: string, runs: CanaryRunCreate[]) => Promise<number | null>;
  recordAlerts: (slug: string, alerts: AlertCreate[]) => Promise<number | null>;
  upsertTrainRun: (slug: string, key: string, input: TrainRunUpsert) => Promise<TrainRunResult>;
  recordTrainMetrics: (key: string, points: TrainMetricPoint[]) => Promise<number | null>;
  listTrainRuns: (slug: string) => Promise<TrainRun[]>;
  getTrainRun: (key: string) => Promise<TrainRunWithSeries | null>;
};
