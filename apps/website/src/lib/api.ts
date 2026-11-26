import { z } from "zod";

export const DEFAULT_API_URL = "http://localhost:8787";

export function apiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");
}

const modeSchema = z.enum(["off", "shadow", "serve"]);
export type Mode = z.infer<typeof modeSchema>;

const taskSchema = z
  .object({
    slug: z.string(),
    version: z.union([z.string(), z.number()]).transform(String),
    snapshotHash: z.string(),
    mode: modeSchema,
    deferralShare: z.number().nullable(),
    lastGatePassed: z.boolean().nullable(),
  })
  .passthrough();
export type Task = z.infer<typeof taskSchema>;

const versionSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  version: z.union([z.string(), z.number()]).transform(String),
  snapshotHash: z.string(),
  gitSha: z.string().nullable(),
  createdAt: z.string(),
});
export type TaskVersion = z.infer<typeof versionSchema>;

const gateCheckSchema = z.object({
  name: z.string(),
  threshold: z.number().nullable(),
  value: z.number().nullable(),
  passed: z.boolean(),
  estimate: z.number().nullable().default(null),
  low: z.number().nullable().default(null),
  high: z.number().nullable().default(null),
  measured: z.boolean().default(true),
  reason: z.string().nullable().default(null),
});
export type GateCheck = z.infer<typeof gateCheckSchema>;

const metricChangeSchema = z.object({ name: z.string(), improved: z.number(), regressed: z.number() });
export type MetricChange = z.infer<typeof metricChangeSchema>;

const gateSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  taskSlug: z.string(),
  createdAt: z.string(),
  passed: z.boolean(),
  checks: z.array(gateCheckSchema),
  evalRunId: z.string().nullable().default(null),
  previousEvalRunId: z.string().nullable().default(null),
  changes: z.array(metricChangeSchema).nullable().default(null),
});
export type Gate = z.infer<typeof gateSchema>;

const evalRunSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  createdAt: z.string(),
  model: z.string(),
  split: z.string(),
  judgeModel: z.string().nullable(),
  mean: z.number(),
  low: z.number(),
  high: z.number(),
  cases: z.number(),
  metrics: z.record(z.string(), z.object({ value: z.number(), low: z.number(), high: z.number() })).default({}),
  primaryMetric: z.string().nullable().default(null),
  benchmark: z.object({ name: z.string(), version: z.string() }).nullable().default(null),
});
export type EvalRun = z.infer<typeof evalRunSchema>;

const caseScoreSchema = z.union([z.number(), z.boolean(), z.string(), z.null()]);

const metricPairSchema = z.object({ before: z.number(), after: z.number() });
export type MetricPair = z.infer<typeof metricPairSchema>;

const compareCaseSchema = z.object({
  inputHash: z.string(),
  before: caseScoreSchema,
  after: caseScoreSchema,
  metrics: z.record(z.string(), metricPairSchema).default({}),
});
export type CompareCase = z.input<typeof compareCaseSchema>;

const histogramBinSchema = z.object({ low: z.number(), high: z.number(), count: z.number() });
export type HistogramBin = z.infer<typeof histogramBinSchema>;

const metricHistogramSchema = z.object({ metric: z.string(), bins: z.array(histogramBinSchema) });
export type MetricHistogram = z.infer<typeof metricHistogramSchema>;

const evalRunDetailSchema = z.object({ run: evalRunSchema, histograms: z.array(metricHistogramSchema).default([]) });
export type EvalRunDetail = z.infer<typeof evalRunDetailSchema>;

const runCaseSchema = z.object({
  inputHash: z.string(),
  score: z.number(),
  input: z.unknown(),
  output: z.unknown(),
  expected: z.unknown(),
  metrics: z.record(z.string(), z.number()).default({}),
});
export type RunCase = z.output<typeof runCaseSchema>;

const runCasePageSchema = z.object({ total: z.number(), offset: z.number(), cases: z.array(runCaseSchema) });
export type RunCasePage = z.infer<typeof runCasePageSchema>;

const verdictSchema = z.enum(["better", "worse", "no_detectable_difference"]);
export type Verdict = z.infer<typeof verdictSchema>;

const estimateSchema = z.object({ value: z.number(), low: z.number(), high: z.number() });

const metricComparisonSchema = z.object({
  name: z.string(),
  before: estimateSchema.nullable(),
  after: estimateSchema.nullable(),
  difference: z.number().nullable(),
  low: z.number().nullable(),
  high: z.number().nullable(),
  paired: z.boolean(),
  verdict: verdictSchema.nullable(),
  improved: z.number().nullable().default(null),
  regressed: z.number().nullable().default(null),
});
export type MetricComparison = z.input<typeof metricComparisonSchema>;

const compareSchema = z.object({
  before: z.unknown(),
  after: z.unknown(),
  difference: z.number(),
  low: z.number(),
  high: z.number(),
  verdict: verdictSchema,
  fixed: z.number(),
  broken: z.number(),
  pairedCases: z.number().optional(),
  signTest: z.object({ pValue: z.number() }).nullable().default(null),
  metrics: z.array(metricComparisonSchema).default([]),
  cases: z.array(compareCaseSchema),
});
export type Comparison = Omit<z.infer<typeof compareSchema>, "cases" | "metrics"> & { cases: CompareCase[]; metrics: MetricComparison[] };

const caseSideSchema = z.object({
  score: z.number(),
  output: z.unknown(),
  metrics: z.record(z.string(), z.number()).default({}),
});

const comparedCaseSchema = z.object({
  inputHash: z.string(),
  input: z.unknown(),
  expected: z.unknown(),
  before: caseSideSchema,
  after: caseSideSchema,
});
export type ComparedCase = z.output<typeof comparedCaseSchema>;

const teacherOutputSchema = z
  .object({ teacher: z.string().optional(), model: z.string().optional(), output: z.unknown() })
  .transform((entry, ctx) => {
    const teacher = entry.teacher ?? entry.model;
    if (teacher === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "teacher output has no teacher name" });
      return z.NEVER;
    }
    return { teacher, output: entry.output as unknown };
  });

const teacherOutputsSchema = z
  .union([z.array(teacherOutputSchema), z.record(z.unknown())])
  .transform((value) =>
    Array.isArray(value) ? value : Object.entries(value).map(([teacher, output]) => ({ teacher, output })),
  );
export type TeacherOutput = { teacher: string; output: unknown };

const reviewItemSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    inputHash: z.string(),
    input: z.unknown(),
    teacherOutputs: teacherOutputsSchema,
    agreement: z
      .union([z.number(), z.boolean()])
      .nullable()
      .transform((value) => (typeof value === "boolean" ? Number(value) : value)),
    reviewState: z.string(),
  })
  .transform((item): ReviewItem => ({ ...item, input: item.input }));
export type ReviewItem = {
  id: string;
  inputHash: string;
  input: unknown;
  teacherOutputs: TeacherOutput[];
  agreement: number | null;
  reviewState: string;
};

const datasetItemSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    inputHash: z.string(),
    input: z.unknown(),
    teacherOutputs: teacherOutputsSchema,
    agreement: z
      .union([z.number(), z.boolean()])
      .nullable()
      .transform((value) => (typeof value === "boolean" ? Number(value) : value)),
    reviewState: z.string(),
    finalOutput: z.unknown(),
  })
  .transform((item): DatasetItem => ({ ...item, input: item.input, finalOutput: item.finalOutput ?? null }));
export type DatasetItem = ReviewItem & { finalOutput: unknown };

export const DATASET_STATES = ["none", "queued", "accepted", "corrected"] as const;
export type DatasetState = (typeof DATASET_STATES)[number];

export type ReviewCandidate = { inputHash: string; input: unknown; outputs: Record<string, unknown> };

export type ReviewDecision =
  | { verdict: "accept"; reviewer: string }
  | { verdict: "correct"; correctedOutput: unknown; reviewer: string };

const deploymentSchema = z.object({
  mode: modeSchema,
  studentModel: z.string().nullable(),
  threshold: z.number().nullable(),
  targetError: z.number().nullable(),
  shadowSample: z.number().nullable(),
  activeFrom: z.string().nullable(),
});
export type Deployment = z.infer<typeof deploymentSchema>;

export type DeploymentUpdate = {
  mode: Mode;
  studentModel: string | null;
  threshold: number | null;
  targetError: number;
  shadowSample: number;
  activeFrom: string | null;
};

export type BulkReviewResult = { items: ReviewItem[]; missing: string[] };

const trafficBucketSchema = z.object({
  hour: z.string(),
  total: z.number(),
  served_student: z.number(),
  deferred: z.number(),
  model_mismatch: z.number(),
  p95_student_ms: z.number().nullable(),
  p95_cloud_ms: z.number().nullable(),
});
export type TrafficBucket = z.infer<typeof trafficBucketSchema>;

const trafficSchema = z.object({
  buckets: z.array(trafficBucketSchema),
  deferralShare: z.number().nullable(),
});
export type Traffic = z.infer<typeof trafficSchema>;

const canaryRunSchema = z.object({
  createdAt: z.string(),
  provider: z.string(),
  passed: z.number(),
  total: z.number(),
  low: z.number(),
  high: z.number(),
});
export type CanaryRun = z.infer<typeof canaryRunSchema>;

const alertSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  kind: z.string(),
  severity: z.string(),
  createdAt: z.string(),
  ackedAt: z.string().nullable(),
  payload: z.unknown(),
});
export type Alert = z.infer<typeof alertSchema>;

const trainStatusSchema = z.enum(["running", "succeeded", "failed"]);
export type TrainStatus = z.infer<typeof trainStatusSchema>;

const trainRunSchema = z.object({
  key: z.string(),
  taskSlug: z.string(),
  base: z.string(),
  method: z.string(),
  status: trainStatusSchema,
  manifest: z.unknown(),
  attestation: z.unknown(),
  finalMetrics: z.record(z.string(), z.number()).nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type TrainRun = z.infer<typeof trainRunSchema>;

const trainSeriesPointSchema = z.object({ step: z.number(), epoch: z.number().nullable(), value: z.number() });
export type TrainSeriesPoint = z.infer<typeof trainSeriesPointSchema>;
export type TrainSeries = Record<string, TrainSeriesPoint[]>;

const trainRunDetailSchema = z.object({
  run: trainRunSchema,
  series: z.record(z.string(), z.array(trainSeriesPointSchema)),
});
export type TrainRunDetail = z.infer<typeof trainRunDetailSchema>;

const keyPermissionSchema = z.enum(["read", "write"]);
export type KeyPermission = z.infer<typeof keyPermissionSchema>;

const createdApiKeySchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  key: z.string(),
  start: z.string().nullable(),
  permission: keyPermissionSchema,
  createdAt: z.string(),
});
export type CreatedApiKey = z.infer<typeof createdApiKeySchema>;

export class ApiError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(message: string, status: number, url: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.url = url;
  }
}

export class ApiUnreachableError extends Error {
  readonly baseUrl: string;

  constructor(baseUrl: string) {
    super(`API unreachable at ${baseUrl}`);
    this.name = "ApiUnreachableError";
    this.baseUrl = baseUrl;
  }
}

export type ApiClientOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  onUnauthorized?: () => void;
};

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? apiBaseUrl()).replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

  async function request<S extends z.ZodTypeAny>(path: string, schema: S, init?: RequestInit): Promise<z.output<S>> {
    const url = `${baseUrl}${path}`;
    let response: Response;
    try {
      response = await fetchImpl(url, {
        ...init,
        credentials: "include",
        headers: { accept: "application/json", ...init?.headers },
      });
    } catch {
      throw new ApiUnreachableError(baseUrl);
    }
    if (response.status === 401) options.onUnauthorized?.();
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new ApiError(`HTTP ${response.status} from ${url}${detail ? `: ${detail.slice(0, 200)}` : ""}`, response.status, url);
    }
    const body: unknown = await response.json().catch(() => undefined);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(`unexpected response from ${url}: ${parsed.error.issues[0]?.message ?? "invalid"}`, response.status, url);
    }
    return parsed.data;
  }

  const task = (slug: string) => `/v1/tasks/${encodeURIComponent(slug)}`;

  return {
    baseUrl,
    listTasks: async () => (await request("/v1/tasks", z.object({ tasks: z.array(taskSchema) }))).tasks,
    getTask: async (slug: string) => (await request(task(slug), z.object({ task: taskSchema }))).task,
    listVersions: async (slug: string) =>
      (await request(`${task(slug)}/versions`, z.object({ versions: z.array(versionSchema) }))).versions,
    listGates: async (slug: string) => (await request(`${task(slug)}/gates`, z.object({ gates: z.array(gateSchema) }))).gates,
    listEvalRuns: async (slug: string) =>
      (await request(`${task(slug)}/eval-runs`, z.object({ runs: z.array(evalRunSchema) }))).runs,
    compareEvalRuns: async (before: string, after: string) =>
      request(`/v1/eval-runs/compare?${new URLSearchParams({ before, after }).toString()}`, compareSchema),
    getEvalRun: async (id: string): Promise<EvalRunDetail> =>
      request(`/v1/eval-runs/${encodeURIComponent(id)}`, evalRunDetailSchema),
    listEvalCases: async (id: string, page: { offset: number; limit: number }): Promise<RunCasePage> =>
      request(
        `/v1/eval-runs/${encodeURIComponent(id)}/cases?${new URLSearchParams({ offset: String(page.offset), limit: String(page.limit) }).toString()}`,
        runCasePageSchema,
      ),
    getComparedCase: async (before: string, after: string, inputHash: string): Promise<ComparedCase> =>
      (
        await request(
          `/v1/eval-runs/compare/case?${new URLSearchParams({ before, after, inputHash }).toString()}`,
          z.object({ case: comparedCaseSchema }),
        )
      ).case,
    listReviewQueue: async (slug: string, limit?: number): Promise<ReviewItem[]> =>
      (
        await request(
          `${task(slug)}/review-queue${limit === undefined ? "" : `?${new URLSearchParams({ limit: String(limit) }).toString()}`}`,
          z.object({ items: z.array(reviewItemSchema) }),
        )
      ).items,
    decideReviewItem: async (itemId: string, decision: ReviewDecision): Promise<ReviewItem> =>
      (
        await request(`/v1/review-queue/${encodeURIComponent(itemId)}/decision`, z.object({ item: reviewItemSchema }), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(decision),
        })
      ).item,
    acceptReviewItems: async (itemIds: string[], reviewer: string): Promise<BulkReviewResult> =>
      request("/v1/review-queue/decisions", z.object({ items: z.array(reviewItemSchema), missing: z.array(z.string()) }), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemIds, verdict: "accept", reviewer }),
      }),
    listDatasetItems: async (slug: string, state?: DatasetState): Promise<DatasetItem[]> =>
      (
        await request(
          `${task(slug)}/dataset-items${state ? `?${new URLSearchParams({ state }).toString()}` : ""}`,
          z.object({ items: z.array(datasetItemSchema) }),
        )
      ).items,
    sendToReview: async (slug: string, candidates: ReviewCandidate[]): Promise<number> =>
      (
        await request(`${task(slug)}/review-items`, z.object({ upserted: z.number() }), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            items: candidates.map((candidate) => ({
              inputHash: candidate.inputHash,
              input: candidate.input,
              teacherOutputs: candidate.outputs,
              agreement: false,
              reviewState: "queued",
            })),
          }),
        })
      ).upserted,
    getDeployment: async (slug: string) =>
      (await request(`${task(slug)}/deployment`, z.object({ deployment: deploymentSchema.nullable() }))).deployment,
    setDeployment: async (slug: string, update: DeploymentUpdate): Promise<Deployment> =>
      (
        await request(`${task(slug)}/deployment`, z.object({ deployment: deploymentSchema }), {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(update),
        })
      ).deployment,
    getTraffic: async (slug: string, hours = 24) => request(`${task(slug)}/traffic?hours=${hours}`, trafficSchema),
    listCanaries: async (slug: string) =>
      (await request(`${task(slug)}/canaries`, z.object({ runs: z.array(canaryRunSchema) }))).runs,
    listAlerts: async (slug: string) => (await request(`${task(slug)}/alerts`, z.object({ alerts: z.array(alertSchema) }))).alerts,
    listTrainRuns: async (slug: string) =>
      (await request(`${task(slug)}/train-runs`, z.object({ runs: z.array(trainRunSchema) }))).runs,
    getTrainRun: async (key: string) => request(`/v1/train-runs/${encodeURIComponent(key)}`, trainRunDetailSchema),
    createApiKey: async (name: string, permission: KeyPermission): Promise<CreatedApiKey> =>
      request("/v1/api-keys", createdApiKeySchema, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, permission }),
      }),
    finishOnboarding: async (): Promise<string> =>
      (await request("/v1/me/onboarding", z.object({ onboardedAt: z.string() }), { method: "POST" })).onboardedAt,
  };
}
