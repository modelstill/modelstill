import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { InsufficientScope, requireCaller, type CallerVariables } from "./auth/caller.ts";
import { createAuth, type Auth } from "./auth/index.ts";
import { markOnboarded } from "./auth/onboarding.ts";
import { API_KEY_PREFIX, permissionOf, permissionsFor } from "./auth/permissions.ts";
import { canonicalUuid, isUuid } from "./headline.ts";
import { describeGate } from "./gate-checks.ts";
import { histogramsFor } from "./histogram.ts";
import { DifferentCasesError, compareMetrics, compareScores, pairedCaseMetrics, signTest } from "./stats.ts";
import type { ReviewDecision, Store } from "./store.ts";
import { deferralShare, noTraffic, type TrafficStore } from "./traffic.ts";
import { createAuthRouter } from "./routers/auth.router.ts";
import { createDatasetsRouter } from "./routers/datasets.router.ts";
import { createRequestsRouter } from "./routers/requests.router.ts";
import type { CaseDatasetStore } from "./datasets.ts";
import { createMemoryDatasets } from "./datasets-memory.ts";
import { noRequests, type RequestLog } from "./requests.ts";
import { docsRouter } from "./routers/docs.router.ts";

export const DEFAULT_CORS_ORIGINS = ["http://localhost:4323", "http://localhost:3000"];
export const DEFAULT_API_URL = "http://localhost:8787";
export const DEFAULT_FRONTEND_URL = "http://localhost:4323";
export const DEFAULT_MCP_RESOURCE = "http://localhost:3104/mcp";

const CALLER_SECURITY: Record<string, string[]>[] = [{ bearerAuth: [] }, { apiKeyHeader: [] }, { sessionCookie: [] }];

const ServingModeSchema = z.enum(["off", "shadow", "serve"]);

const TaskSummary = z
  .object({
    slug: z.string(),
    version: z.number().int(),
    snapshotHash: z.string(),
    mode: ServingModeSchema,
    deferralShare: z.number().nullable(),
    lastGatePassed: z.boolean().nullable(),
  })
  .openapi("TaskSummary");

const TaskVersion = z
  .object({
    id: z.string(),
    version: z.number().int(),
    snapshotHash: z.string(),
    gitSha: z.string(),
    createdAt: z.string(),
  })
  .openapi("TaskVersion");

const GateCheckInput = z
  .object({
    name: z.string(),
    threshold: z.number(),
    value: z.number(),
    passed: z.boolean(),
    estimate: z.number().nullable().optional(),
    low: z.number().nullable().optional(),
    high: z.number().nullable().optional(),
    measured: z.boolean().optional(),
    reason: z.string().min(1).nullable().optional(),
  })
  .openapi("GateCheckInput");

const GateCheck = z
  .object({
    name: z.string(),
    threshold: z.number(),
    value: z.number(),
    passed: z.boolean(),
    estimate: z.number().nullable().openapi({ description: "The point estimate the checked value was read from" }),
    low: z.number().nullable().openapi({ description: "Lower end of the estimate's 95% interval" }),
    high: z.number().nullable().openapi({ description: "Upper end of the estimate's 95% interval" }),
    measured: z.boolean().openapi({ description: "False when the check was recorded at a failing worst-case value" }),
    reason: z.string().nullable().openapi({ description: "Why the check was not measured" }),
  })
  .openapi("GateCheck");

const MetricChange = z
  .object({ name: z.string(), improved: z.number().int(), regressed: z.number().int() })
  .openapi("MetricChange");

const GateRecord = z
  .object({
    id: z.string(),
    taskSlug: z.string(),
    createdAt: z.string(),
    passed: z.boolean(),
    checks: z.array(GateCheck),
    evalRunId: z.string().nullable(),
    previousEvalRunId: z.string().nullable(),
    changes: z
      .array(MetricChange)
      .nullable()
      .openapi({ description: "Cases that improved or regressed against the baseline run, for the case score and each paired metric; null without a baseline" }),
  })
  .openapi("GateRecord");

const Metric = z
  .object({ value: z.number(), low: z.number(), high: z.number() })
  .openapi("Metric");

const BenchmarkRef = z.object({ name: z.string().min(1), version: z.string().min(1) }).openapi("BenchmarkRef");

const SplitSchema = z.enum(["train", "val", "calib", "gold"]);

const EvalRun = z
  .object({
    id: z.string(),
    createdAt: z.string(),
    model: z.string(),
    split: SplitSchema,
    judgeModel: z.string(),
    mean: z.number(),
    low: z.number(),
    high: z.number(),
    cases: z.number().int(),
    metrics: z.record(z.string(), Metric),
    primaryMetric: z.string().nullable(),
    benchmark: BenchmarkRef.nullable(),
  })
  .openapi("EvalRun");

const MetricPair = z.object({ before: z.number(), after: z.number() }).openapi("MetricPair");

const PairedCase = z
  .object({
    inputHash: z.string(),
    before: z.number(),
    after: z.number(),
    metrics: z.record(z.string(), MetricPair).openapi({ description: "Both runs' values for every paired metric" }),
  })
  .openapi("PairedCase");

const VerdictSchema = z.enum(["better", "worse", "no_detectable_difference"]);

const MetricComparison = z
  .object({
    name: z.string(),
    before: Metric.nullable(),
    after: Metric.nullable(),
    difference: z.number().nullable(),
    low: z.number().nullable(),
    high: z.number().nullable(),
    paired: z.boolean().openapi({ description: "True when both runs logged this metric per case, so the difference has a paired interval" }),
    verdict: VerdictSchema.nullable(),
    improved: z.number().int().nullable().openapi({ description: "Cases whose value went up against the baseline; null when not paired" }),
    regressed: z.number().int().nullable().openapi({ description: "Cases whose value went down against the baseline; null when not paired" }),
  })
  .openapi("MetricComparison");

const EvalComparison = z
  .object({
    before: EvalRun,
    after: EvalRun,
    difference: z.number(),
    low: z.number(),
    high: z.number(),
    verdict: VerdictSchema,
    fixed: z.number().int(),
    broken: z.number().int(),
    pairedCases: z.number().int(),
    signTest: z.object({ pValue: z.number() }).openapi({ description: "Exact two-sided sign test of fixed against broken" }),
    metrics: z.array(MetricComparison),
    cases: z.array(PairedCase),
  })
  .openapi("EvalComparison");

const CaseSide = z
  .object({ score: z.number(), output: z.unknown(), metrics: z.record(z.string(), z.number()) })
  .openapi("CaseSide");

const ComparedCase = z
  .object({ inputHash: z.string(), input: z.unknown(), expected: z.unknown(), before: CaseSide, after: CaseSide })
  .openapi("ComparedCase");

const CaseDetail = z
  .object({
    inputHash: z.string(),
    score: z.number(),
    input: z.unknown(),
    output: z.unknown(),
    expected: z.unknown(),
    metrics: z.record(z.string(), z.number()),
  })
  .openapi("CaseDetail");

const HistogramBin = z.object({ low: z.number(), high: z.number(), count: z.number().int() }).openapi("HistogramBin");

const MetricHistogram = z
  .object({ metric: z.string(), bins: z.array(HistogramBin) })
  .openapi("MetricHistogram");

const ReviewItem = z
  .object({
    id: z.string(),
    inputHash: z.string(),
    input: z.unknown(),
    teacherOutputs: z.unknown(),
    agreement: z.boolean().nullable(),
    reviewState: z.enum(["none", "queued", "accepted", "corrected"]),
  })
  .openapi("ReviewItem");

const ReviewDecisionSchema = z
  .object({
    verdict: z.enum(["accept", "correct"]),
    correctedOutput: z.unknown().optional(),
    reviewer: z.string().min(1),
  })
  .refine((body) => body.verdict === "accept" || body.correctedOutput !== undefined, {
    message: "a correction needs correctedOutput",
    path: ["correctedOutput"],
  })
  .openapi("ReviewDecision");

const BulkReviewDecision = z
  .object({
    itemIds: z.array(z.string().min(1)).min(1).max(500),
    verdict: z.enum(["accept"]),
    reviewer: z.string().min(1),
  })
  .openapi("BulkReviewDecision");

const Deployment = z
  .object({
    mode: ServingModeSchema,
    studentModel: z.string().nullable(),
    threshold: z.number().nullable(),
    targetError: z.number(),
    shadowSample: z.number(),
    activeFrom: z.string(),
  })
  .openapi("Deployment");

const TrafficBucket = z
  .object({
    hour: z.string(),
    total: z.number().int(),
    served_student: z.number().int(),
    deferred: z.number().int(),
    model_mismatch: z.number().int(),
    p95_student_ms: z.number().nullable(),
    p95_cloud_ms: z.number().nullable(),
  })
  .openapi("TrafficBucket");

const CanaryRun = z
  .object({
    createdAt: z.string(),
    provider: z.string(),
    passed: z.number().int(),
    total: z.number().int(),
    low: z.number(),
    high: z.number(),
  })
  .openapi("CanaryRun");

const Alert = z
  .object({
    id: z.string(),
    kind: z.string(),
    severity: z.string(),
    createdAt: z.string(),
    ackedAt: z.string().nullable(),
    payload: z.unknown(),
  })
  .openapi("Alert");

const UuidSchema = z.string().refine(isUuid, { message: "expected a uuid, with or without dashes" });

const TaskUpsert = z
  .object({
    version: z.number().int().min(1),
    snapshotHash: z.string().min(1),
    gitSha: z.string().min(1),
    spec: z.record(z.string(), z.unknown()),
    owner: z.string().min(1).optional(),
  })
  .openapi("TaskUpsert");

const PushedCase = z.object({
  inputHash: z.string().min(1),
  score: z.number(),
  output: z.unknown(),
  metrics: z.record(z.string(), z.number()).optional(),
  input: z.unknown(),
  expected: z.unknown(),
});

const EvalRunCreate = z
  .object({
    id: UuidSchema,
    createdAt: z.string().datetime({ offset: true }),
    model: z.string().min(1),
    split: SplitSchema.default("gold"),
    judgeModel: z.string().nullable().optional(),
    benchmark: BenchmarkRef.nullable().optional(),
    metrics: z.record(z.string(), Metric).default({}),
    primaryMetric: z.string().nullable().optional(),
    cases: z.array(PushedCase).min(1).max(100_000),
  })
  .refine((body) => !body.primaryMetric || body.primaryMetric in body.metrics, {
    message: "primaryMetric must name one of metrics",
    path: ["primaryMetric"],
  })
  .refine((body) => new Set(body.cases.map((entry) => entry.inputHash)).size === body.cases.length, {
    message: "every case needs a distinct inputHash",
    path: ["cases"],
  })
  .openapi("EvalRunCreate");

const GateCreate = z
  .object({
    id: UuidSchema,
    evalRunId: UuidSchema,
    previousEvalRunId: UuidSchema.nullable().optional(),
    passed: z.boolean(),
    checks: z.array(GateCheckInput),
    report: z.record(z.string(), z.unknown()),
  })
  .openapi("GateCreate");

const ReviewItemUpsert = z.object({
  inputHash: z.string().min(1),
  input: z.unknown(),
  teacherOutputs: z.unknown(),
  agreement: z.boolean().nullable().default(null),
  reviewState: z.enum(["none", "queued", "accepted", "corrected"]).default("queued"),
});

const ReviewItemsUpsert = z
  .object({ items: z.array(ReviewItemUpsert).max(1000) })
  .openapi("ReviewItemsUpsert");

const DeploymentUpdate = z
  .object({
    mode: ServingModeSchema,
    studentModel: z.string().min(1).nullable().default(null),
    threshold: z.number().min(0).max(1).nullable().default(null),
    targetError: z.number().gt(0).lt(1),
    shadowSample: z.number().min(0).max(1).default(0.1),
    activeFrom: z.string().datetime({ offset: true }).nullable().default(null),
  })
  .openapi("DeploymentUpdate");

const CanaryRunCreate = z
  .object({
    id: UuidSchema.optional(),
    createdAt: z.string().datetime({ offset: true }),
    provider: z.string().min(1),
    passed: z.number().int().min(0),
    total: z.number().int().min(0),
    low: z.number().min(0).max(1),
    high: z.number().min(0).max(1),
  })
  .refine((run) => run.passed <= run.total, { message: "passed cannot exceed total", path: ["passed"] })
  .refine((run) => run.low <= run.high, { message: "low cannot exceed high", path: ["low"] });

const CanaryRunsCreate = z.object({ runs: z.array(CanaryRunCreate).min(1).max(1000) }).openapi("CanaryRunsCreate");

const AlertCreate = z.object({
  id: UuidSchema.optional(),
  kind: z.string().min(1),
  severity: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  payload: z.unknown(),
});

const AlertsCreate = z.object({ alerts: z.array(AlertCreate).min(1).max(1000) }).openapi("AlertsCreate");

const Recorded = z.object({ recorded: z.number().int() }).openapi("Recorded");

const TrainStatusSchema = z.enum(["running", "succeeded", "failed"]);

const TrainRun = z
  .object({
    key: z.string(),
    taskSlug: z.string(),
    base: z.string(),
    method: z.string(),
    status: TrainStatusSchema,
    manifest: z.unknown(),
    attestation: z.unknown(),
    finalMetrics: z.record(z.string(), z.number()).nullable(),
    startedAt: z.string(),
    finishedAt: z.string().nullable(),
  })
  .openapi("TrainRun");

const TrainRunUpsert = z
  .object({
    base: z.string().min(1),
    method: z.string().min(1),
    status: TrainStatusSchema,
    manifest: z.record(z.string(), z.unknown()).optional(),
    attestation: z.record(z.string(), z.unknown()).optional(),
    finalMetrics: z.record(z.string(), z.number()).optional(),
    startedAt: z.string().datetime({ offset: true }).optional(),
    finishedAt: z.string().datetime({ offset: true }).optional(),
  })
  .openapi("TrainRunUpsert");

const TrainMetricPoint = z.object({
  step: z.number().int().min(0),
  epoch: z.number().nullable().optional(),
  name: z.string().min(1).max(200),
  value: z.number(),
});

const TrainMetricsBatch = z
  .object({ metrics: z.array(TrainMetricPoint).max(10_000) })
  .openapi("TrainMetricsBatch");

const TrainSeriesPoint = z
  .object({ step: z.number().int(), epoch: z.number().nullable(), value: z.number() })
  .openapi("TrainSeriesPoint");

const Unauthorized = z.object({ error: z.literal("unauthorized") }).openapi("Unauthorized");
const Forbidden = z.object({ error: z.literal("forbidden") }).openapi("Forbidden");

const ApiKeyCreate = z
  .object({ name: z.string().trim().min(1).max(32), permission: z.enum(["read", "write"]) })
  .openapi("ApiKeyCreate");

const CreatedApiKey = z
  .object({
    id: z.string(),
    name: z.string().nullable(),
    key: z.string().openapi({ description: `The full key, shown once; it starts with ${API_KEY_PREFIX}` }),
    start: z.string().nullable(),
    permission: z.enum(["read", "write"]),
    createdAt: z.string(),
  })
  .openapi("CreatedApiKey");

const NotFound = z.object({ error: z.literal("not_found") }).openapi("NotFound");
const Conflict = z.object({ error: z.literal("conflict") }).openapi("Conflict");
const BadRequest = z
  .object({
    error: z.string(),
    issues: z
      .array(z.object({ message: z.string(), path: z.array(z.union([z.string(), z.number()])) }))
      .optional(),
  })
  .openapi("BadRequest");
const SlugParam = z.object({ slug: z.string().openapi({ param: { name: "slug", in: "path" } }) });
const TrainKey = z
  .string()
  .regex(/^[A-Za-z0-9._-]{1,200}$/, { message: "a train run key is letters, digits, dots, dashes and underscores" });
const KeyParam = z.object({ key: TrainKey.openapi({ param: { name: "key", in: "path" } }) });
const SlugKeyParam = SlugParam.merge(KeyParam);
const RunParam = z.object({ id: z.string().openapi({ param: { name: "id", in: "path" } }) });
const ItemParam = z.object({ itemId: z.string().openapi({ param: { name: "itemId", in: "path" } }) });

function json<T extends z.ZodTypeAny>(description: string, schema: T) {
  return { description, content: { "application/json": { schema } } };
}

const notFound = json("Not found", NotFound);
const badRequest = json("Invalid request", BadRequest);
const unauthorized = json("No session, API key, OAuth token or admin token", Unauthorized);
const forbidden = json("The credential lacks the permission or scope this needs", Forbidden);
const secured = { security: CALLER_SECURITY };

function body<T extends z.ZodTypeAny>(schema: T) {
  return { content: { "application/json": { schema } }, required: true };
}

function slugRoute<T extends z.ZodTypeAny>(path: string, description: string, schema: T) {
  return createRoute({
    method: "get",
    ...secured,
    path: `/v1/tasks/{slug}${path}`,
    request: { params: SlugParam },
    responses: { 200: json(description, schema) },
  });
}

const listTasks = createRoute({
  method: "get",
  ...secured,
  path: "/v1/tasks",
  responses: { 200: json("Every task", z.object({ tasks: z.array(TaskSummary) })) },
});

const getTask = createRoute({
  method: "get",
  ...secured,
  path: "/v1/tasks/{slug}",
  request: { params: SlugParam },
  responses: { 200: json("One task", z.object({ task: TaskSummary })), 404: notFound },
});

const listVersions = slugRoute(
  "/versions",
  "Versions of a task, newest first",
  z.object({ versions: z.array(TaskVersion) }),
);

const listGates = slugRoute(
  "/gates",
  "Gate decisions for a task, newest first, with every check",
  z.object({ gates: z.array(GateRecord) }),
);

const listEvalRuns = slugRoute(
  "/eval-runs",
  "Eval runs for a task, newest first, each with a mean and a 95% interval",
  z.object({ runs: z.array(EvalRun) }),
);

const compareEvalRuns = createRoute({
  method: "get",
  ...secured,
  path: "/v1/eval-runs/compare",
  request: { query: z.object({ before: z.string().min(1), after: z.string().min(1) }) },
  responses: {
    200: json("Paired comparison with a seeded 95% percentile bootstrap interval", EvalComparison),
    400: badRequest,
    404: notFound,
  },
});

const compareEvalCase = createRoute({
  method: "get",
  ...secured,
  path: "/v1/eval-runs/compare/case",
  request: {
    query: z.object({ before: z.string().min(1), after: z.string().min(1), inputHash: z.string().min(1) }),
  },
  responses: {
    200: json(
      "One case from both runs: input, expected answer, both outputs and their per-case scores",
      z.object({ case: ComparedCase }),
    ),
    400: badRequest,
    404: notFound,
  },
});

const getEvalRun = createRoute({
  method: "get",
  ...secured,
  path: "/v1/eval-runs/{id}",
  request: { params: RunParam },
  responses: {
    200: json(
      "One eval run with a histogram of the case score and of every metric each case logged",
      z.object({ run: EvalRun, histograms: z.array(MetricHistogram) }),
    ),
    404: notFound,
  },
});

const listEvalCases = createRoute({
  method: "get",
  ...secured,
  path: "/v1/eval-runs/{id}/cases",
  request: {
    params: RunParam,
    query: z.object({
      offset: z.coerce.number().int().min(0).default(0),
      limit: z.coerce.number().int().min(1).max(500).default(200),
    }),
  },
  responses: {
    200: json(
      "A page of the run's cases, lowest score first, each with input, output, expected answer and per-metric scores",
      z.object({ total: z.number().int(), offset: z.number().int(), cases: z.array(CaseDetail) }),
    ),
    400: badRequest,
    404: notFound,
  },
});

const reviewQueue = createRoute({
  method: "get",
  ...secured,
  path: "/v1/tasks/{slug}/review-queue",
  request: {
    params: SlugParam,
    query: z.object({ limit: z.coerce.number().int().min(1).max(500).default(50) }),
  },
  responses: {
    200: json("Dataset items queued for human review", z.object({ items: z.array(ReviewItem) })),
    400: badRequest,
  },
});

const DatasetItem = ReviewItem.extend({ finalOutput: z.unknown() }).openapi("DatasetItem");

const datasetItems = createRoute({
  method: "get",
  ...secured,
  path: "/v1/tasks/{slug}/dataset-items",
  request: {
    params: SlugParam,
    query: z.object({
      state: z.enum(["none", "queued", "accepted", "corrected"]).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(200),
    }),
  },
  responses: {
    200: json("Every dataset item of the task with its review state and the output a reviewer settled on", z.object({ items: z.array(DatasetItem) })),
    400: badRequest,
  },
});

const decideReview = createRoute({
  method: "post",
  ...secured,
  path: "/v1/review-queue/{itemId}/decision",
  request: {
    params: ItemParam,
    body: { content: { "application/json": { schema: ReviewDecisionSchema } }, required: true },
  },
  responses: {
    200: json("The reviewed item", z.object({ item: ReviewItem })),
    400: badRequest,
    401: unauthorized,
    403: forbidden,
    404: notFound,
  },
});

const decideReviews = createRoute({
  method: "post",
  ...secured,
  path: "/v1/review-queue/decisions",
  description: "Accept many review items at once. A correction needs its own output, so it stays a single-item decision.",
  request: {
    body: { content: { "application/json": { schema: BulkReviewDecision } }, required: true },
  },
  responses: {
    200: json(
      "The decided items, and the ids that matched no item",
      z.object({ items: z.array(ReviewItem), missing: z.array(z.string()) }),
    ),
    400: badRequest,
    401: unauthorized,
    403: forbidden,
  },
});

const createApiKey = createRoute({
  method: "post",
  path: "/v1/api-keys",
  ...secured,
  description: "Create an API key for the signed-in dashboard user. Only a session can do this; the key is returned once.",
  request: { body: { content: { "application/json": { schema: ApiKeyCreate } }, required: true } },
  responses: {
    201: json("The new key, shown only in this response", CreatedApiKey),
    400: badRequest,
    401: unauthorized,
    403: forbidden,
  },
});

const finishOnboarding = createRoute({
  method: "post",
  path: "/v1/me/onboarding",
  ...secured,
  description: "Mark the signed-in dashboard user as onboarded. Repeating it keeps the first time.",
  responses: {
    200: json("When the user finished onboarding", z.object({ onboardedAt: z.string() })),
    401: unauthorized,
    403: forbidden,
  },
});

const getDeployment = slugRoute(
  "/deployment",
  "The task's current deployment, or null",
  z.object({ deployment: Deployment.nullable() }),
);

const getTraffic = createRoute({
  method: "get",
  ...secured,
  path: "/v1/tasks/{slug}/traffic",
  request: {
    params: SlugParam,
    query: z.object({ hours: z.coerce.number().int().min(1).max(720).default(24) }),
  },
  responses: {
    200: json(
      "Hourly serving traffic and the share of calls deferred to the cloud model",
      z.object({ buckets: z.array(TrafficBucket), deferralShare: z.number().nullable() }),
    ),
    400: badRequest,
  },
});

const listCanaries = slugRoute("/canaries", "Canary runs, newest first", z.object({ runs: z.array(CanaryRun) }));

const listAlerts = slugRoute("/alerts", "Alerts, newest first", z.object({ alerts: z.array(Alert) }));

const listTrainRuns = slugRoute(
  "/train-runs",
  "Training runs for a task, newest first",
  z.object({ runs: z.array(TrainRun) }),
);

const getTrainRun = createRoute({
  method: "get",
  ...secured,
  path: "/v1/train-runs/{key}",
  request: { params: KeyParam },
  responses: {
    200: json(
      "One training run with every logged metric as a series ordered by step",
      z.object({ run: TrainRun, series: z.record(z.string(), z.array(TrainSeriesPoint)) }),
    ),
    400: badRequest,
    404: notFound,
  },
});

type AppOptions = {
  store: Store;
  traffic?: TrafficStore;
  datasets?: CaseDatasetStore;
  requests?: RequestLog;
  corsOrigins?: string[];
  apiToken?: string;
  auth?: Auth;
  frontendUrl?: string;
};

function memoizedRuns(store: Store) {
  const runs = new Map<string, ReturnType<Store["getEvalRunWithScores"]>>();
  return (id: string) => {
    const key = canonicalUuid(id);
    if (!runs.has(key)) runs.set(key, store.getEvalRunWithScores(key));
    return runs.get(key)!;
  };
}

function writeRoutes() {
  const write = { 400: badRequest, 401: unauthorized, 403: forbidden, 404: notFound };

  return {
    upsertTask: createRoute({
      method: "put",
      path: "/v1/tasks/{slug}",
      ...secured,
      request: { params: SlugParam, body: body(TaskUpsert) },
      responses: {
        200: json(
          "The task and the registered version, which becomes current",
          z.object({ task: TaskSummary, version: TaskVersion }),
        ),
        ...write,
      },
    }),
    createEvalRun: createRoute({
      method: "post",
      path: "/v1/tasks/{slug}/eval-runs",
      ...secured,
      request: { params: SlugParam, body: body(EvalRunCreate) },
      responses: {
        200: json("The run already existed; it is returned unchanged", z.object({ run: EvalRun })),
        201: json("The run was created against the task's current version", z.object({ run: EvalRun })),
        ...write,
      },
    }),
    recordGate: createRoute({
      method: "post",
      path: "/v1/tasks/{slug}/gates",
      ...secured,
      request: { params: SlugParam, body: body(GateCreate) },
      responses: {
        200: json("The gate already existed; it is returned unchanged", z.object({ gate: GateRecord })),
        201: json("The gate was recorded with every check and the full report", z.object({ gate: GateRecord })),
        ...write,
      },
    }),
    upsertReviewItems: createRoute({
      method: "post",
      path: "/v1/tasks/{slug}/review-items",
      ...secured,
      request: { params: SlugParam, body: body(ReviewItemsUpsert) },
      responses: {
        200: json(
          "Items upserted by input hash; a human decision is never overwritten",
          z.object({ upserted: z.number().int() }),
        ),
        ...write,
      },
    }),
    setDeployment: createRoute({
      method: "put",
      path: "/v1/tasks/{slug}/deployment",
      ...secured,
      request: { params: SlugParam, body: body(DeploymentUpdate) },
      responses: { 200: json("The deployment now in effect", z.object({ deployment: Deployment })), ...write },
    }),
    recordCanaries: createRoute({
      method: "post",
      path: "/v1/tasks/{slug}/canaries",
      ...secured,
      request: { params: SlugParam, body: body(CanaryRunsCreate) },
      responses: {
        200: json("Runs recorded; a run sent again with the same id is skipped", Recorded),
        ...write,
      },
    }),
    recordAlerts: createRoute({
      method: "post",
      path: "/v1/tasks/{slug}/alerts",
      ...secured,
      request: { params: SlugParam, body: body(AlertsCreate) },
      responses: {
        200: json("Alerts recorded unacknowledged; an alert sent again with the same id is skipped", Recorded),
        ...write,
      },
    }),
    upsertTrainRun: createRoute({
      method: "put",
      path: "/v1/tasks/{slug}/train-runs/{key}",
      ...secured,
      request: { params: SlugKeyParam, body: body(TrainRunUpsert) },
      responses: {
        200: json("The run as stored; fields left out keep their stored value", z.object({ run: TrainRun })),
        409: json("The key belongs to a run of another task", Conflict),
        ...write,
      },
    }),
    recordTrainMetrics: createRoute({
      method: "post",
      path: "/v1/train-runs/{key}/metrics",
      ...secured,
      request: { params: KeyParam, body: body(TrainMetricsBatch) },
      responses: {
        200: json(
          "Points stored by run, step and name; sending a point again replaces it",
          z.object({ accepted: z.number().int() }),
        ),
        ...write,
      },
    }),
  };
}

export function createApp({
  store,
  traffic = noTraffic,
  datasets = createMemoryDatasets(),
  requests = noRequests,
  corsOrigins = DEFAULT_CORS_ORIGINS,
  apiToken,
  frontendUrl = DEFAULT_FRONTEND_URL,
  auth = createAuth({
    baseURL: DEFAULT_API_URL,
    frontendUrl,
    mcpResource: DEFAULT_MCP_RESOURCE,
    trustedOrigins: corsOrigins,
  }),
}: AppOptions) {
  const app = new OpenAPIHono<{ Variables: CallerVariables }>({
    defaultHook: (result, c) => {
      if (!result.success) return c.json({ error: "invalid_request", issues: result.error.issues }, 400);
    },
  });
  const resourceMetadata = `${String(auth.options.baseURL).replace(/\/+$/, "")}/.well-known/oauth-protected-resource`;

  app.onError((error, c) => {
    if (error instanceof InsufficientScope) {
      c.header("WWW-Authenticate", `Bearer error="insufficient_scope", scope="${error.scope}"`);
      return c.json({ error: "forbidden" }, 403);
    }
    if (error instanceof HTTPException) {
      if (error.status === 401) c.header("WWW-Authenticate", `Bearer resource_metadata="${resourceMetadata}"`);
      return c.json({ error: error.message }, error.status);
    }
    console.error(error);
    return c.json({ error: "internal_error" }, 500);
  });

  app.use("*", cors({ origin: corsOrigins, credentials: true }));
  app.use("/v1/*", requireCaller(auth, apiToken));
  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    description: `An API key (${API_KEY_PREFIX}...), an MCP OAuth access token, or the admin token`,
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "apiKeyHeader", { type: "apiKey", in: "header", name: "x-api-key" });
  app.openAPIRegistry.registerComponent("securitySchemes", "sessionCookie", {
    type: "apiKey",
    in: "cookie",
    name: "better-auth.session_token",
  });
  const writes = writeRoutes();

  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/", createAuthRouter(auth, frontendUrl));
  app.route("/docs", docsRouter);
  app.route("/", createDatasetsRouter({ store, datasets }));
  app.route("/", createRequestsRouter({ requests }));

  app.openapi(createApiKey, async (c) => {
    const caller = c.get("caller");
    if (caller.authType !== "session" || !caller.userId) return c.json({ error: "forbidden" as const }, 403);
    const { name, permission } = c.req.valid("json");
    const created = await auth.api.createApiKey({
      body: { userId: caller.userId, name, permissions: permissionsFor(permission) },
    });
    return c.json(
      {
        id: created.id,
        name: created.name ?? null,
        key: created.key,
        start: created.start ?? null,
        permission: permissionOf(created.permissions),
        createdAt: new Date(created.createdAt).toISOString(),
      },
      201,
    );
  });

  app.openapi(finishOnboarding, async (c) => {
    const caller = c.get("caller");
    if (caller.authType !== "session" || !caller.userId) return c.json({ error: "forbidden" as const }, 403);
    return c.json({ onboardedAt: (await markOnboarded(auth, caller.userId)).toISOString() }, 200);
  });

  app.openapi(listTasks, async (c) => c.json({ tasks: await store.listTasks() }, 200));

  app.openapi(getTask, async (c) => {
    const task = await store.getTask(c.req.valid("param").slug);
    if (!task) return c.json({ error: "not_found" as const }, 404);
    return c.json({ task }, 200);
  });

  app.openapi(listVersions, async (c) =>
    c.json({ versions: await store.listVersions(c.req.valid("param").slug) }, 200),
  );

  app.openapi(listGates, async (c) => {
    const lookup = memoizedRuns(store);
    const gates = await store.listGates(c.req.valid("param").slug);
    return c.json({ gates: await Promise.all(gates.map((gate) => describeGate(gate, lookup))) }, 200);
  });

  app.openapi(listEvalRuns, async (c) =>
    c.json({ runs: await store.listEvalRuns(c.req.valid("param").slug) }, 200),
  );

  app.openapi(compareEvalRuns, async (c) => {
    const query = c.req.valid("query");
    const [before, after] = await Promise.all([
      store.getEvalRunWithScores(canonicalUuid(query.before)),
      store.getEvalRunWithScores(canonicalUuid(query.after)),
    ]);
    if (!before || !after) return c.json({ error: "not_found" as const }, 404);
    try {
      const comparison = compareScores(before.scores, after.scores);
      const metrics = compareMetrics(
        { metrics: before.run.metrics, scores: before.scores },
        { metrics: after.run.metrics, scores: after.scores },
      );
      const pairs = pairedCaseMetrics(
        before.scores,
        after.scores,
        metrics.filter((metric) => metric.paired).map((metric) => metric.name),
      );
      return c.json(
        {
          before: before.run,
          after: after.run,
          ...comparison,
          cases: comparison.cases.map((entry) => ({ ...entry, metrics: pairs.get(entry.inputHash) ?? {} })),
          pairedCases: comparison.cases.length,
          signTest: { pValue: signTest(comparison.fixed, comparison.broken) },
          metrics,
        },
        200,
      );
    } catch (error) {
      if (error instanceof DifferentCasesError) return c.json({ error: "different_cases" }, 400);
      throw error;
    }
  });

  app.openapi(compareEvalCase, async (c) => {
    const query = c.req.valid("query");
    const [before, after] = await Promise.all([
      store.getEvalCase(canonicalUuid(query.before), query.inputHash),
      store.getEvalCase(canonicalUuid(query.after), query.inputHash),
    ]);
    if (!before || !after) return c.json({ error: "not_found" as const }, 404);
    const side = ({ score, output, metrics }: typeof before) => ({ score, output, metrics });
    const compared: z.infer<typeof ComparedCase> = {
      inputHash: query.inputHash,
      input: after.input ?? before.input,
      expected: after.expected ?? before.expected,
      before: side(before),
      after: side(after),
    };
    return c.json({ case: compared }, 200);
  });

  app.openapi(getEvalRun, async (c) => {
    const found = await store.getEvalRunWithScores(canonicalUuid(c.req.valid("param").id));
    if (!found) return c.json({ error: "not_found" as const }, 404);
    return c.json({ run: found.run, histograms: histogramsFor(found.scores) }, 200);
  });

  app.openapi(listEvalCases, async (c) => {
    const { offset, limit } = c.req.valid("query");
    const page = await store.listEvalCases(canonicalUuid(c.req.valid("param").id), { offset, limit });
    if (!page) return c.json({ error: "not_found" as const }, 404);
    return c.json({ total: page.total, offset, cases: page.cases }, 200);
  });

  app.openapi(datasetItems, async (c) => {
    const { state, limit } = c.req.valid("query");
    return c.json({ items: await store.listDatasetItems(c.req.valid("param").slug, { state, limit }) }, 200);
  });

  app.openapi(reviewQueue, async (c) =>
    c.json(
      { items: await store.listReviewQueue(c.req.valid("param").slug, c.req.valid("query").limit) },
      200,
    ),
  );

  app.openapi(decideReview, async (c) => {
    const body = c.req.valid("json");
    const decision: ReviewDecision =
      body.verdict === "correct"
        ? { verdict: "correct", reviewer: body.reviewer, correctedOutput: body.correctedOutput }
        : { verdict: "accept", reviewer: body.reviewer };
    const item = await store.decideReview(c.req.valid("param").itemId, decision);
    if (!item) return c.json({ error: "not_found" as const }, 404);
    return c.json({ item }, 200);
  });

  app.openapi(decideReviews, async (c) => {
    const { itemIds, reviewer } = c.req.valid("json");
    const items = [];
    const missing = [];
    for (const itemId of new Set(itemIds)) {
      const item = await store.decideReview(itemId, { verdict: "accept", reviewer });
      if (item) items.push(item);
      else missing.push(itemId);
    }
    return c.json({ items, missing }, 200);
  });

  app.openapi(getDeployment, async (c) =>
    c.json({ deployment: await store.getDeployment(c.req.valid("param").slug) }, 200),
  );

  app.openapi(getTraffic, async (c) => {
    const buckets = await traffic.hourly(c.req.valid("param").slug, c.req.valid("query").hours);
    return c.json({ buckets, deferralShare: deferralShare(buckets) }, 200);
  });

  app.openapi(listCanaries, async (c) => c.json({ runs: await store.listCanaries(c.req.valid("param").slug) }, 200));

  app.openapi(listAlerts, async (c) => c.json({ alerts: await store.listAlerts(c.req.valid("param").slug) }, 200));

  app.openapi(listTrainRuns, async (c) =>
    c.json({ runs: await store.listTrainRuns(c.req.valid("param").slug) }, 200),
  );

  app.openapi(getTrainRun, async (c) => {
    const found = await store.getTrainRun(c.req.valid("param").key);
    if (!found) return c.json({ error: "not_found" as const }, 404);
    return c.json(found, 200);
  });

  app.openapi(writes.upsertTask, async (c) =>
    c.json(await store.upsertTask(c.req.valid("param").slug, c.req.valid("json")), 200),
  );

  app.openapi(writes.createEvalRun, async (c) => {
    const input = c.req.valid("json");
    const result = await store.createEvalRun(c.req.valid("param").slug, {
      ...input,
      id: canonicalUuid(input.id),
      judgeModel: input.judgeModel ?? "",
      benchmark: input.benchmark ?? null,
      primaryMetric: input.primaryMetric ?? null,
    });
    if (!result) return c.json({ error: "not_found" as const }, 404);
    return result.created ? c.json({ run: result.value }, 201) : c.json({ run: result.value }, 200);
  });

  app.openapi(writes.recordGate, async (c) => {
    const input = c.req.valid("json");
    const result = await store.recordGate(c.req.valid("param").slug, {
      ...input,
      id: canonicalUuid(input.id),
      evalRunId: canonicalUuid(input.evalRunId),
      previousEvalRunId: input.previousEvalRunId ? canonicalUuid(input.previousEvalRunId) : null,
    });
    if (typeof result === "string") return c.json({ error: "not_found" as const }, 404);
    const gate = await describeGate(result.value, memoizedRuns(store));
    return result.created ? c.json({ gate }, 201) : c.json({ gate }, 200);
  });

  app.openapi(writes.upsertReviewItems, async (c) => {
    const upserted = await store.upsertReviewItems(c.req.valid("param").slug, c.req.valid("json").items);
    if (upserted === null) return c.json({ error: "not_found" as const }, 404);
    return c.json({ upserted }, 200);
  });

  app.openapi(writes.setDeployment, async (c) => {
    const deployment = await store.setDeployment(c.req.valid("param").slug, c.req.valid("json"));
    if (!deployment) return c.json({ error: "not_found" as const }, 404);
    return c.json({ deployment }, 200);
  });

  app.openapi(writes.recordCanaries, async (c) => {
    const runs = c.req.valid("json").runs.map(({ id, createdAt, ...run }) => ({
      ...run,
      createdAt: new Date(createdAt).toISOString(),
      id: id ? canonicalUuid(id) : null,
    }));
    const recorded = await store.recordCanaries(c.req.valid("param").slug, runs);
    if (recorded === null) return c.json({ error: "not_found" as const }, 404);
    return c.json({ recorded }, 200);
  });

  app.openapi(writes.recordAlerts, async (c) => {
    const rows = c.req.valid("json").alerts.map(({ id, payload, createdAt, ...alert }) => ({
      ...alert,
      createdAt: new Date(createdAt).toISOString(),
      payload: payload ?? {},
      id: id ? canonicalUuid(id) : null,
    }));
    const recorded = await store.recordAlerts(c.req.valid("param").slug, rows);
    if (recorded === null) return c.json({ error: "not_found" as const }, 404);
    return c.json({ recorded }, 200);
  });

  app.openapi(writes.upsertTrainRun, async (c) => {
    const { slug, key } = c.req.valid("param");
    const run = await store.upsertTrainRun(slug, key, c.req.valid("json"));
    if (run === "task_mismatch") return c.json({ error: "conflict" as const }, 409);
    return c.json({ run }, 200);
  });

  app.openapi(writes.recordTrainMetrics, async (c) => {
    const points = c.req.valid("json").metrics.map((point) => ({ ...point, epoch: point.epoch ?? null }));
    const accepted = await store.recordTrainMetrics(c.req.valid("param").key, points);
    if (accepted === null) return c.json({ error: "not_found" as const }, 404);
    return c.json({ accepted }, 200);
  });

  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "ModelStill API", version: "0.1.0" },
  });

  return app;
}
