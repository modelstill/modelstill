import { canonicalUuid, caseHeadline, primaryHeadline } from "./headline.ts";
import type { CaseScore } from "./stats.ts";
import type {
  Alert,
  BenchmarkRef,
  CanaryRun,
  CaseDetail,
  Deployment,
  EvalRun,
  GateRecord,
  Metric,
  ReviewItem,
  SplitName,
  Store,
  TaskSummary,
  TaskVersion,
  TrainMetricPoint,
  TrainRun,
} from "./store.ts";
import { groupSeries, lastPerStepAndName, mergeTrainRun, newestStartedFirst } from "./train-runs.ts";

export type MemoryEvalRun = {
  taskSlug: string;
  id: string;
  createdAt: string;
  model: string;
  split: SplitName;
  judgeModel: string;
  scores: CaseScore[];
  details?: Record<string, Omit<CaseDetail, "inputHash" | "score">>;
  metrics?: Record<string, Metric>;
  primaryMetric?: string | null;
  benchmark?: BenchmarkRef | null;
};

export type MemoryData = {
  tasks?: TaskSummary[];
  gates?: GateRecord[];
  versions?: (TaskVersion & { taskSlug: string })[];
  evalRuns?: MemoryEvalRun[];
  reviewItems?: (ReviewItem & { taskSlug: string })[];
  deployments?: Record<string, Deployment>;
  canaries?: Record<string, CanaryRun[]>;
  alerts?: Record<string, Alert[]>;
  trainRuns?: TrainRun[];
  trainMetrics?: (TrainMetricPoint & { runKey: string })[];
};

export type RecordedReview = {
  itemId: string;
  verdict: string;
  reviewer: string;
  correctedOutput: unknown;
};

export type MemoryStore = Store & {
  reviews: RecordedReview[];
  finalOutputs: Map<string, unknown>;
};

function newestFirst<T extends { createdAt: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function withoutSlug<T extends { taskSlug: string }>({ taskSlug: _taskSlug, ...rest }: T) {
  return rest;
}

function toEvalRun({ scores, details: _details, taskSlug: _taskSlug, ...run }: MemoryEvalRun): EvalRun {
  const metrics = run.metrics ?? {};
  const primaryMetric = run.primaryMetric ?? null;
  const headline = primaryHeadline(metrics, primaryMetric) ?? caseHeadline(scores.map((entry) => entry.score));
  return { ...run, ...headline, cases: scores.length, metrics, primaryMetric, benchmark: run.benchmark ?? null };
}

const DECIDED = new Set(["accepted", "corrected"]);

export function createMemoryStore(data: MemoryData = {}): MemoryStore {
  const tasks = [...(data.tasks ?? [])];
  const versions = [...(data.versions ?? [])];
  const gates = [...(data.gates ?? [])];
  const evalRuns = [...(data.evalRuns ?? [])];
  const deployments = { ...data.deployments };
  const canaries: Record<string, CanaryRun[]> = Object.fromEntries(
    Object.entries(data.canaries ?? {}).map(([slug, runs]) => [slug, [...runs]]),
  );
  const canaryIds = new Set<string>();
  const alerts: Record<string, Alert[]> = Object.fromEntries(
    Object.entries(data.alerts ?? {}).map(([slug, rows]) => [slug, [...rows]]),
  );
  const alertIds = new Set(Object.values(alerts).flatMap((rows) => rows.map((row) => row.id)));
  const reviewItems = (data.reviewItems ?? []).map((item) => ({ ...item }));
  const trainRuns = new Map((data.trainRuns ?? []).map((run) => [run.key, { ...run }]));
  const trainMetrics = new Map<string, Map<string, TrainMetricPoint>>();
  const pointKey = (point: TrainMetricPoint) => `${point.step}\u0000${point.name}`;
  const remember = (runKey: string, points: readonly TrainMetricPoint[]) => {
    const stored = trainMetrics.get(runKey) ?? new Map<string, TrainMetricPoint>();
    for (const point of points) stored.set(pointKey(point), point);
    trainMetrics.set(runKey, stored);
  };
  for (const { runKey, ...point } of data.trainMetrics ?? []) remember(runKey, [point]);
  const reviews: RecordedReview[] = [];
  const finalOutputs = new Map<string, unknown>();
  const findTask = (slug: string) => tasks.find((task) => task.slug === slug) ?? null;
  const findRun = (id: string) => evalRuns.find((candidate) => candidate.id === canonicalUuid(id));
  const caseDetail = (run: MemoryEvalRun, scored: CaseScore): CaseDetail => {
    const detail = run.details?.[scored.inputHash];
    const input =
      detail?.input ??
      reviewItems.find((item) => item.taskSlug === run.taskSlug && item.inputHash === scored.inputHash)?.input ??
      null;
    return {
      inputHash: scored.inputHash,
      score: scored.score,
      output: detail?.output ?? null,
      metrics: detail?.metrics ?? scored.metrics ?? {},
      input,
      expected: detail?.expected ?? null,
    };
  };

  return {
    reviews,
    finalOutputs,
    listTasks: async () => [...tasks].sort((left, right) => left.slug.localeCompare(right.slug)),
    getTask: async (slug) => findTask(slug),
    listVersions: async (slug) =>
      versions
        .filter((version) => version.taskSlug === slug)
        .sort((left, right) => right.version - left.version)
        .map(withoutSlug),
    listGates: async (slug) => newestFirst(gates.filter((gate) => gate.taskSlug === slug)),
    listEvalRuns: async (slug) => newestFirst(evalRuns.filter((run) => run.taskSlug === slug)).map(toEvalRun),
    getEvalRunWithScores: async (id) => {
      const run = findRun(id);
      return run ? { run: toEvalRun(run), scores: run.scores } : null;
    },
    getEvalCase: async (runId, inputHash) => {
      const run = findRun(runId);
      const scored = run?.scores.find((entry) => entry.inputHash === inputHash);
      return run && scored ? caseDetail(run, scored) : null;
    },
    listEvalCases: async (runId, { offset, limit }) => {
      const run = findRun(runId);
      if (!run) return null;
      const ordered = [...run.scores].sort(
        (left, right) => left.score - right.score || left.inputHash.localeCompare(right.inputHash),
      );
      return { total: ordered.length, cases: ordered.slice(offset, offset + limit).map((scored) => caseDetail(run, scored)) };
    },
    listReviewQueue: async (slug, limit) =>
      reviewItems
        .filter((item) => item.taskSlug === slug && item.reviewState === "queued")
        .slice(0, limit)
        .map(withoutSlug),
    listDatasetItems: async (slug, { state, limit }) =>
      reviewItems
        .filter((item) => item.taskSlug === slug && (state === undefined || item.reviewState === state))
        .slice(0, limit)
        .map((item) => ({ ...withoutSlug(item), finalOutput: finalOutputs.get(item.id) ?? null })),
    decideReview: async (itemId, decision) => {
      const item = reviewItems.find((candidate) => candidate.id === itemId);
      if (!item) return null;
      const correctedOutput = decision.verdict === "correct" ? decision.correctedOutput : null;
      reviews.push({ itemId, verdict: decision.verdict, reviewer: decision.reviewer, correctedOutput });
      item.reviewState = decision.verdict === "correct" ? "corrected" : "accepted";
      if (decision.verdict === "correct") finalOutputs.set(itemId, correctedOutput);
      return withoutSlug(item);
    },
    getDeployment: async (slug) => deployments[slug] ?? null,
    listCanaries: async (slug) => newestFirst(canaries[slug] ?? []),
    listAlerts: async (slug) => newestFirst(alerts[slug] ?? []),

    upsertTask: async (slug, input) => {
      let version = versions.find((entry) => entry.taskSlug === slug && entry.snapshotHash === input.snapshotHash);
      if (!version) {
        version = {
          taskSlug: slug,
          id: crypto.randomUUID(),
          version: input.version,
          snapshotHash: input.snapshotHash,
          gitSha: input.gitSha,
          createdAt: new Date().toISOString(),
        };
        versions.push(version);
      }
      const existing = findTask(slug);
      const summary: TaskSummary = {
        slug,
        version: version.version,
        snapshotHash: version.snapshotHash,
        mode: existing?.mode ?? "off",
        deferralShare: existing?.deferralShare ?? null,
        lastGatePassed: existing?.lastGatePassed ?? null,
      };
      if (existing) Object.assign(existing, summary);
      else tasks.push(summary);
      return { task: summary, version: withoutSlug(version) };
    },

    createEvalRun: async (slug, input) => {
      if (!findTask(slug)) return null;
      const id = canonicalUuid(input.id);
      const existing = findRun(id);
      if (existing) return { value: toEvalRun(existing), created: false };
      const run: MemoryEvalRun = {
        taskSlug: slug,
        id,
        createdAt: input.createdAt,
        model: input.model,
        split: input.split,
        judgeModel: input.judgeModel,
        scores: input.cases.map(({ inputHash, score, metrics }) => (metrics ? { inputHash, score, metrics } : { inputHash, score })),
        details: Object.fromEntries(
          input.cases.map((entry) => [
            entry.inputHash,
            { output: entry.output ?? null, metrics: entry.metrics ?? {}, input: entry.input ?? null, expected: entry.expected ?? null },
          ]),
        ),
        metrics: input.metrics,
        primaryMetric: input.primaryMetric,
        benchmark: input.benchmark,
      };
      evalRuns.push(run);
      return { value: toEvalRun(run), created: true };
    },

    recordGate: async (slug, input) => {
      const task = findTask(slug);
      if (!task) return "task_not_found";
      if (!findRun(input.evalRunId)) return "run_not_found";
      if (input.previousEvalRunId && !findRun(input.previousEvalRunId)) return "run_not_found";
      const id = canonicalUuid(input.id);
      const existing = gates.find((gate) => gate.id === id);
      if (existing) return { value: existing, created: false };
      const gate: GateRecord = {
        id,
        taskSlug: slug,
        createdAt: new Date().toISOString(),
        passed: input.passed,
        checks: input.checks,
        evalRunId: canonicalUuid(input.evalRunId),
        previousEvalRunId: input.previousEvalRunId ? canonicalUuid(input.previousEvalRunId) : null,
        report: input.report,
      };
      gates.push(gate);
      task.lastGatePassed = gate.passed;
      return { value: gate, created: true };
    },

    upsertReviewItems: async (slug, items) => {
      if (!findTask(slug)) return null;
      for (const item of items) {
        const existing = reviewItems.find((entry) => entry.taskSlug === slug && entry.inputHash === item.inputHash);
        if (!existing) {
          reviewItems.push({
            ...item,
            input: item.input ?? null,
            teacherOutputs: item.teacherOutputs ?? null,
            taskSlug: slug,
            id: crypto.randomUUID(),
          });
          continue;
        }
        Object.assign(existing, { input: item.input, teacherOutputs: item.teacherOutputs, agreement: item.agreement });
        if (!DECIDED.has(existing.reviewState)) existing.reviewState = item.reviewState;
      }
      return items.length;
    },

    setDeployment: async (slug, input) => {
      const task = findTask(slug);
      if (!task) return null;
      const { activeFrom, ...rest } = input;
      const deployment: Deployment = { ...rest, activeFrom: activeFrom ?? new Date().toISOString() };
      deployments[slug] = deployment;
      task.mode = deployment.mode;
      return deployment;
    },

    recordCanaries: async (slug, runs) => {
      if (!findTask(slug)) return null;
      const stored = (canaries[slug] ??= []);
      let recorded = 0;
      for (const { id, ...run } of runs) {
        if (id !== null && canaryIds.has(id)) continue;
        if (id !== null) canaryIds.add(id);
        stored.push(run);
        recorded += 1;
      }
      return recorded;
    },

    recordAlerts: async (slug, rows) => {
      if (!findTask(slug)) return null;
      const stored = (alerts[slug] ??= []);
      let recorded = 0;
      for (const { id, ...alert } of rows) {
        const key = id ?? crypto.randomUUID();
        if (alertIds.has(key)) continue;
        alertIds.add(key);
        stored.push({ ...alert, id: key, ackedAt: null });
        recorded += 1;
      }
      return recorded;
    },

    upsertTrainRun: async (slug, key, input) => {
      const existing = trainRuns.get(key) ?? null;
      if (existing && existing.taskSlug !== slug) return "task_mismatch";
      const run = mergeTrainRun(slug, key, input, existing);
      trainRuns.set(key, run);
      return run;
    },

    recordTrainMetrics: async (key, points) => {
      if (!trainRuns.has(key)) return null;
      const unique = lastPerStepAndName(points);
      remember(key, unique);
      return unique.length;
    },

    listTrainRuns: async (slug) => newestStartedFirst([...trainRuns.values()].filter((run) => run.taskSlug === slug)),

    getTrainRun: async (key) => {
      const run = trainRuns.get(key);
      if (!run) return null;
      return { run, series: groupSeries([...(trainMetrics.get(key)?.values() ?? [])]) };
    },
  };
}
