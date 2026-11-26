import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database, Executor } from "./db/client.ts";
import {
  adapters,
  alerts,
  canaryRuns,
  datasetItems,
  datasets,
  deployments,
  evalRuns,
  evalScores,
  gates,
  reviews,
  taskVersions,
  tasks,
  trainMetrics,
  trainRuns,
} from "./db/schema.ts";
import { contentHash } from "./hash.ts";
import { canonicalUuid, caseHeadline, isUuid, primaryHeadline } from "./headline.ts";
import type { CaseScore } from "./stats.ts";
import type {
  Deployment,
  EvalRun,
  GateCheck,
  GateRecord,
  Metric,
  ReviewItem,
  ReviewItemUpsert,
  Store,
  TaskSummary,
  TrainRun,
} from "./store.ts";
import { groupSeries, lastPerStepAndName, mergeTrainRun } from "./train-runs.ts";

const LIST_LIMIT = 200;
const INSERT_CHUNK = 1000;

function iso(value: Date): string {
  return value.toISOString();
}

function chunks<T>(rows: readonly T[], size = INSERT_CHUNK): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < rows.length; start += size) result.push(rows.slice(start, start + size));
  return result;
}

function lastByHash(items: readonly ReviewItemUpsert[]): ReviewItemUpsert[] {
  return [...new Map(items.map((item) => [item.inputHash, item])).values()];
}

function storedMetrics(value: unknown): Record<string, Metric> {
  return value && typeof value === "object" ? (value as Record<string, Metric>) : {};
}

type Summary = { mean: number; low: number; high: number };

function storedSummary(value: unknown): Summary | null {
  if (!value || typeof value !== "object") return null;
  const { mean, low, high } = value as Record<string, unknown>;
  if (typeof mean !== "number" || typeof low !== "number" || typeof high !== "number") return null;
  return { mean, low, high };
}

function numericMetrics(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, number] => entry[0] !== "score" && typeof entry[1] === "number",
    ),
  );
}

function caseScore(row: { inputHash: string; metrics: unknown; judgeScore: number | null }): CaseScore {
  const metric = (row.metrics as Record<string, unknown> | null)?.["score"];
  const score = typeof metric === "number" ? metric : (row.judgeScore ?? 0);
  const metrics = numericMetrics(row.metrics);
  return Object.keys(metrics).length > 0 ? { inputHash: row.inputHash, score, metrics } : { inputHash: row.inputHash, score };
}

const reviewItemColumns = {
  id: datasetItems.id,
  inputHash: datasetItems.inputHash,
  input: datasetItems.input,
  teacherOutputs: datasetItems.teacherOutputs,
  agreement: datasetItems.agreement,
  reviewState: datasetItems.reviewState,
};

type TrainRunRow = typeof trainRuns.$inferSelect;

function toTrainRun(row: TrainRunRow): TrainRun {
  return {
    key: row.key,
    taskSlug: row.taskSlug,
    base: row.base,
    method: row.method,
    status: row.status as TrainRun["status"],
    manifest: row.manifest ?? null,
    attestation: row.attestation ?? null,
    finalMetrics: (row.finalMetrics as Record<string, number> | null) ?? null,
    startedAt: iso(row.startedAt),
    finishedAt: row.finishedAt ? iso(row.finishedAt) : null,
  };
}

export function createPostgresStore(db: Database): Store {
  const evalRunColumns = {
    id: evalRuns.id,
    createdAt: evalRuns.createdAt,
    servedName: adapters.servedName,
    cloudAlias: evalRuns.cloudAlias,
    split: evalRuns.split,
    judgeModel: evalRuns.judgeModel,
    summary: evalRuns.summary,
    model: evalRuns.model,
    metrics: evalRuns.metrics,
    primaryMetric: evalRuns.primaryMetric,
    benchmarkName: evalRuns.benchmarkName,
    benchmarkVersion: evalRuns.benchmarkVersion,
  };

  async function scoresFor(runId: string): Promise<CaseScore[]> {
    const rows = await db
      .select({ inputHash: evalScores.inputHash, metrics: evalScores.metrics, judgeScore: evalScores.judgeScore })
      .from(evalScores)
      .where(eq(evalScores.evalRunId, runId))
      .orderBy(asc(evalScores.inputHash));
    return rows.map(caseScore);
  }

  async function toEvalRun(row: {
    id: string;
    createdAt: Date;
    servedName: string | null;
    cloudAlias: string | null;
    split: EvalRun["split"];
    judgeModel: string;
    summary: unknown;
    model: string | null;
    metrics: unknown;
    primaryMetric: string | null;
    benchmarkName: string | null;
    benchmarkVersion: string | null;
  }): Promise<EvalRun> {
    const [counted] = await db.select({ cases: count() }).from(evalScores).where(eq(evalScores.evalRunId, row.id));
    const cases = counted?.cases ?? 0;
    const metrics = storedMetrics(row.metrics);
    const summary =
      primaryHeadline(metrics, row.primaryMetric) ??
      storedSummary(row.summary) ??
      caseHeadline((await scoresFor(row.id)).map((entry) => entry.score));
    return {
      id: row.id,
      createdAt: iso(row.createdAt),
      model: row.model ?? row.servedName ?? row.cloudAlias ?? "unknown",
      split: row.split,
      judgeModel: row.judgeModel,
      mean: summary.mean,
      low: summary.low,
      high: summary.high,
      cases,
      metrics,
      primaryMetric: row.primaryMetric,
      benchmark:
        row.benchmarkName && row.benchmarkVersion ? { name: row.benchmarkName, version: row.benchmarkVersion } : null,
    };
  }

  async function findEvalRun(id: string): Promise<EvalRun | null> {
    if (!isUuid(id)) return null;
    const [row] = await db
      .select(evalRunColumns)
      .from(evalRuns)
      .leftJoin(adapters, eq(evalRuns.adapterId, adapters.id))
      .where(eq(evalRuns.id, canonicalUuid(id)));
    return row ? toEvalRun(row) : null;
  }

  async function currentVersion(slug: string): Promise<{ taskId: string; versionId: string } | null> {
    const [task] = await db.select({ id: tasks.id, currentVersionId: tasks.currentVersionId }).from(tasks).where(eq(tasks.slug, slug));
    if (!task) return null;
    if (task.currentVersionId) return { taskId: task.id, versionId: task.currentVersionId };
    const [newest] = await db
      .select({ id: taskVersions.id })
      .from(taskVersions)
      .where(eq(taskVersions.taskId, task.id))
      .orderBy(desc(taskVersions.version))
      .limit(1);
    return newest ? { taskId: task.id, versionId: newest.id } : null;
  }

  async function datasetFor(tx: Executor, taskId: string, versionId: string, name: string): Promise<string> {
    const [existing] = await tx
      .select({ id: datasets.id })
      .from(datasets)
      .innerJoin(taskVersions, eq(datasets.taskVersionId, taskVersions.id))
      .where(and(eq(taskVersions.taskId, taskId), eq(datasets.name, name)))
      .orderBy(asc(datasets.createdAt))
      .limit(1);
    if (existing) return existing.id;
    const [created] = await tx.insert(datasets).values({ taskVersionId: versionId, name }).returning({ id: datasets.id });
    return created!.id;
  }

  function toGateRecord(
    slug: string,
    row: { id: string; createdAt: Date; passed: boolean; checks: unknown; evalRunId: string; previousEvalRunId: string | null; report: unknown },
  ): GateRecord {
    return {
      id: row.id,
      taskSlug: slug,
      createdAt: iso(row.createdAt),
      passed: row.passed,
      checks: row.checks as GateCheck[],
      evalRunId: row.evalRunId,
      previousEvalRunId: row.previousEvalRunId,
      report: row.report,
    };
  }

  const gateColumns = {
    id: gates.id,
    createdAt: gates.createdAt,
    passed: gates.passed,
    checks: gates.checks,
    evalRunId: gates.evalRunId,
    previousEvalRunId: gates.previousEvalRunId,
    report: gates.report,
  };

  const deploymentColumns = {
    mode: deployments.mode,
    studentModel: deployments.studentModel,
    threshold: deployments.threshold,
    targetError: deployments.targetError,
    shadowSample: deployments.shadowSample,
    activeFrom: deployments.activeFrom,
  };

  function toDeployment(row: Omit<Deployment, "activeFrom"> & { activeFrom: Date }): Deployment {
    return { ...row, activeFrom: iso(row.activeFrom) };
  }

  async function summarize(task: { id: string; slug: string; currentVersionId: string | null }): Promise<TaskSummary> {
    const [versions, deployment, gate] = await Promise.all([
      db
        .select({ id: taskVersions.id, version: taskVersions.version, snapshotHash: taskVersions.snapshotHash })
        .from(taskVersions)
        .where(eq(taskVersions.taskId, task.id))
        .orderBy(desc(taskVersions.version)),
      db
        .select({ mode: deployments.mode })
        .from(deployments)
        .where(eq(deployments.taskId, task.id))
        .orderBy(desc(deployments.activeFrom), desc(deployments.createdAt))
        .limit(1),
      db
        .select({ passed: gates.passed })
        .from(gates)
        .innerJoin(taskVersions, eq(gates.taskVersionId, taskVersions.id))
        .where(eq(taskVersions.taskId, task.id))
        .orderBy(desc(gates.createdAt))
        .limit(1),
    ]);
    const current = versions.find((version) => version.id === task.currentVersionId) ?? versions[0];
    return {
      slug: task.slug,
      version: current?.version ?? 0,
      snapshotHash: current?.snapshotHash ?? "",
      mode: deployment[0]?.mode ?? "off",
      deferralShare: null,
      lastGatePassed: gate[0]?.passed ?? null,
    };
  }

  const taskColumns = { id: tasks.id, slug: tasks.slug, currentVersionId: tasks.currentVersionId };

  return {
    listTasks: async () => {
      const rows = await db.select(taskColumns).from(tasks).orderBy(asc(tasks.slug));
      return Promise.all(rows.map(summarize));
    },

    getTask: async (slug) => {
      const [row] = await db.select(taskColumns).from(tasks).where(eq(tasks.slug, slug));
      return row ? summarize(row) : null;
    },

    listVersions: async (slug) => {
      const rows = await db
        .select({
          id: taskVersions.id,
          version: taskVersions.version,
          snapshotHash: taskVersions.snapshotHash,
          gitSha: taskVersions.gitSha,
          createdAt: taskVersions.createdAt,
        })
        .from(taskVersions)
        .innerJoin(tasks, eq(taskVersions.taskId, tasks.id))
        .where(eq(tasks.slug, slug))
        .orderBy(desc(taskVersions.version));
      return rows.map((row) => ({ ...row, createdAt: iso(row.createdAt) }));
    },

    listGates: async (slug) => {
      const rows = await db
        .select(gateColumns)
        .from(gates)
        .innerJoin(taskVersions, eq(gates.taskVersionId, taskVersions.id))
        .innerJoin(tasks, eq(taskVersions.taskId, tasks.id))
        .where(eq(tasks.slug, slug))
        .orderBy(desc(gates.createdAt))
        .limit(LIST_LIMIT);
      return rows.map((row) => toGateRecord(slug, row));
    },

    listEvalRuns: async (slug) => {
      const rows = await db
        .select(evalRunColumns)
        .from(evalRuns)
        .innerJoin(taskVersions, eq(evalRuns.taskVersionId, taskVersions.id))
        .innerJoin(tasks, eq(taskVersions.taskId, tasks.id))
        .leftJoin(adapters, eq(evalRuns.adapterId, adapters.id))
        .where(eq(tasks.slug, slug))
        .orderBy(desc(evalRuns.createdAt))
        .limit(LIST_LIMIT);
      return Promise.all(rows.map(toEvalRun));
    },

    getEvalRunWithScores: async (id) => {
      const run = await findEvalRun(id);
      return run ? { run, scores: await scoresFor(run.id) } : null;
    },

    getEvalCase: async (runId, inputHash) => {
      if (!isUuid(runId)) return null;
      const [row] = await db
        .select({
          inputHash: evalScores.inputHash,
          output: evalScores.output,
          metrics: evalScores.metrics,
          judgeScore: evalScores.judgeScore,
          input: evalScores.input,
          expected: evalScores.expected,
          taskId: taskVersions.taskId,
        })
        .from(evalScores)
        .innerJoin(evalRuns, eq(evalScores.evalRunId, evalRuns.id))
        .innerJoin(taskVersions, eq(evalRuns.taskVersionId, taskVersions.id))
        .where(and(eq(evalScores.evalRunId, canonicalUuid(runId)), eq(evalScores.inputHash, inputHash)));
      if (!row) return null;
      const stored =
        row.input ??
        (
          await db
            .select({ input: datasetItems.input })
            .from(datasetItems)
            .innerJoin(datasets, eq(datasetItems.datasetId, datasets.id))
            .innerJoin(taskVersions, eq(datasets.taskVersionId, taskVersions.id))
            .where(and(eq(taskVersions.taskId, row.taskId), eq(datasetItems.inputHash, inputHash)))
            .limit(1)
        )[0]?.input ??
        null;
      return {
        inputHash: row.inputHash,
        score: caseScore(row).score,
        output: row.output ?? null,
        metrics: numericMetrics(row.metrics),
        input: stored,
        expected: row.expected ?? null,
      };
    },

    listEvalCases: async (runId, { offset, limit }) => {
      if (!isUuid(runId)) return null;
      const id = canonicalUuid(runId);
      const [run] = await db
        .select({ taskId: taskVersions.taskId })
        .from(evalRuns)
        .innerJoin(taskVersions, eq(evalRuns.taskVersionId, taskVersions.id))
        .where(eq(evalRuns.id, id));
      if (!run) return null;
      const [counted] = await db.select({ cases: count() }).from(evalScores).where(eq(evalScores.evalRunId, id));
      const rows = await db
        .select({
          inputHash: evalScores.inputHash,
          output: evalScores.output,
          metrics: evalScores.metrics,
          judgeScore: evalScores.judgeScore,
          input: evalScores.input,
          expected: evalScores.expected,
        })
        .from(evalScores)
        .where(eq(evalScores.evalRunId, id))
        .orderBy(
          asc(sql`coalesce((${evalScores.metrics}->>'score')::double precision, ${evalScores.judgeScore}, 0)`),
          asc(evalScores.inputHash),
        )
        .offset(offset)
        .limit(limit);
      const missing = rows.filter((row) => row.input === null).map((row) => row.inputHash);
      const reviewed =
        missing.length === 0
          ? []
          : await db
              .select({ inputHash: datasetItems.inputHash, input: datasetItems.input })
              .from(datasetItems)
              .innerJoin(datasets, eq(datasetItems.datasetId, datasets.id))
              .innerJoin(taskVersions, eq(datasets.taskVersionId, taskVersions.id))
              .where(and(eq(taskVersions.taskId, run.taskId), inArray(datasetItems.inputHash, missing)));
      const inputs = new Map(reviewed.map((row) => [row.inputHash, row.input]));
      return {
        total: counted?.cases ?? 0,
        cases: rows.map((row) => ({
          inputHash: row.inputHash,
          score: caseScore(row).score,
          output: row.output ?? null,
          metrics: numericMetrics(row.metrics),
          input: row.input ?? inputs.get(row.inputHash) ?? null,
          expected: row.expected ?? null,
        })),
      };
    },

    listReviewQueue: async (slug, limit) =>
      db
        .select(reviewItemColumns)
        .from(datasetItems)
        .innerJoin(datasets, eq(datasetItems.datasetId, datasets.id))
        .innerJoin(taskVersions, eq(datasets.taskVersionId, taskVersions.id))
        .innerJoin(tasks, eq(taskVersions.taskId, tasks.id))
        .where(and(eq(tasks.slug, slug), eq(datasetItems.reviewState, "queued")))
        .orderBy(asc(datasetItems.createdAt), asc(datasetItems.id))
        .limit(limit),

    listDatasetItems: async (slug, { state, limit }) =>
      db
        .select({ ...reviewItemColumns, finalOutput: datasetItems.finalOutput })
        .from(datasetItems)
        .innerJoin(datasets, eq(datasetItems.datasetId, datasets.id))
        .innerJoin(taskVersions, eq(datasets.taskVersionId, taskVersions.id))
        .innerJoin(tasks, eq(taskVersions.taskId, tasks.id))
        .where(state === undefined ? eq(tasks.slug, slug) : and(eq(tasks.slug, slug), eq(datasetItems.reviewState, state)))
        .orderBy(asc(datasetItems.createdAt), asc(datasetItems.id))
        .limit(limit),

    decideReview: async (itemId, decision) => {
      if (!isUuid(itemId)) return null;
      return db.transaction(async (tx) => {
        const [existing] = await tx.select({ id: datasetItems.id }).from(datasetItems).where(eq(datasetItems.id, itemId)).for("update");
        if (!existing) return null;
        const corrected = decision.verdict === "correct";
        await tx.insert(reviews).values({
          itemId,
          kind: "label",
          reviewer: decision.reviewer,
          verdict: decision.verdict,
          correctedOutput: corrected ? decision.correctedOutput : null,
        });
        const [updated] = await tx
          .update(datasetItems)
          .set(
            corrected
              ? {
                  reviewState: "corrected",
                  finalOutput: decision.correctedOutput,
                  finalOutputHash: contentHash(decision.correctedOutput),
                }
              : { reviewState: "accepted" },
          )
          .where(eq(datasetItems.id, itemId))
          .returning(reviewItemColumns);
        return (updated as ReviewItem | undefined) ?? null;
      });
    },

    getDeployment: async (slug) => {
      const [row] = await db
        .select(deploymentColumns)
        .from(deployments)
        .innerJoin(tasks, eq(deployments.taskId, tasks.id))
        .where(eq(tasks.slug, slug))
        .orderBy(desc(deployments.activeFrom), desc(deployments.createdAt))
        .limit(1);
      return row ? toDeployment(row) : null;
    },

    listCanaries: async (slug) => {
      const rows = await db
        .select({
          createdAt: canaryRuns.createdAt,
          provider: canaryRuns.provider,
          passed: canaryRuns.passed,
          total: canaryRuns.total,
          low: canaryRuns.low,
          high: canaryRuns.high,
        })
        .from(canaryRuns)
        .innerJoin(tasks, eq(canaryRuns.taskId, tasks.id))
        .where(eq(tasks.slug, slug))
        .orderBy(desc(canaryRuns.createdAt))
        .limit(LIST_LIMIT);
      return rows.map((row) => ({ ...row, createdAt: iso(row.createdAt) }));
    },

    listAlerts: async (slug) => {
      const rows = await db
        .select({
          id: alerts.id,
          kind: alerts.kind,
          severity: alerts.severity,
          createdAt: alerts.createdAt,
          ackedAt: alerts.ackedAt,
          payload: alerts.payload,
        })
        .from(alerts)
        .innerJoin(tasks, eq(alerts.taskId, tasks.id))
        .where(eq(tasks.slug, slug))
        .orderBy(desc(alerts.createdAt))
        .limit(LIST_LIMIT);
      return rows.map((row) => ({
        ...row,
        createdAt: iso(row.createdAt),
        ackedAt: row.ackedAt ? iso(row.ackedAt) : null,
      }));
    },

    upsertTask: async (slug, input) => {
      const version = await db.transaction(async (tx) => {
        await tx
          .insert(tasks)
          .values({ slug, owner: input.owner ?? "modelstill" })
          .onConflictDoNothing({ target: tasks.slug });
        const [task] = await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.slug, slug));
        await tx
          .insert(taskVersions)
          .values({ taskId: task!.id, version: input.version, snapshotHash: input.snapshotHash, gitSha: input.gitSha, spec: input.spec })
          .onConflictDoNothing({ target: [taskVersions.taskId, taskVersions.snapshotHash] });
        const [row] = await tx
          .select({
            id: taskVersions.id,
            version: taskVersions.version,
            snapshotHash: taskVersions.snapshotHash,
            gitSha: taskVersions.gitSha,
            createdAt: taskVersions.createdAt,
          })
          .from(taskVersions)
          .where(and(eq(taskVersions.taskId, task!.id), eq(taskVersions.snapshotHash, input.snapshotHash)));
        await tx.update(tasks).set({ currentVersionId: row!.id }).where(eq(tasks.id, task!.id));
        return { ...row!, createdAt: iso(row!.createdAt) };
      });
      const [task] = await db.select(taskColumns).from(tasks).where(eq(tasks.slug, slug));
      return { task: await summarize(task!), version };
    },

    createEvalRun: async (slug, input) => {
      const target = await currentVersion(slug);
      if (!target) return null;
      const id = canonicalUuid(input.id);
      const existing = await findEvalRun(id);
      if (existing) return { value: existing, created: false };
      const datasetName = input.benchmark ? `benchmark:${input.benchmark.name}@${input.benchmark.version}` : `${slug}-eval`;
      const created = await db.transaction(async (tx) => {
        const datasetId = await datasetFor(tx, target.taskId, target.versionId, datasetName);
        const inserted = await tx
          .insert(evalRuns)
          .values({
            id,
            taskVersionId: target.versionId,
            datasetId,
            split: input.split,
            judgeModel: input.judgeModel,
            model: input.model,
            summary: caseHeadline(input.cases.map((entry) => entry.score)),
            metrics: input.metrics,
            primaryMetric: input.primaryMetric,
            benchmarkName: input.benchmark?.name ?? null,
            benchmarkVersion: input.benchmark?.version ?? null,
            createdAt: new Date(input.createdAt),
          })
          .onConflictDoNothing({ target: evalRuns.id })
          .returning({ id: evalRuns.id });
        if (inserted.length === 0) return false;
        for (const batch of chunks(input.cases)) {
          await tx.insert(evalScores).values(
            batch.map((entry) => ({
              evalRunId: id,
              inputHash: entry.inputHash,
              output: entry.output ?? null,
              metrics: { ...entry.metrics, score: entry.score },
              input: entry.input ?? null,
              expected: entry.expected ?? null,
            })),
          );
        }
        return true;
      });
      const run = await findEvalRun(id);
      return run ? { value: run, created } : null;
    },

    recordGate: async (slug, raw) => {
      const input = {
        ...raw,
        id: canonicalUuid(raw.id),
        evalRunId: canonicalUuid(raw.evalRunId),
        previousEvalRunId: raw.previousEvalRunId ? canonicalUuid(raw.previousEvalRunId) : null,
      };
      const [task] = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.slug, slug));
      if (!task) return "task_not_found";
      const runIds = [input.evalRunId, ...(input.previousEvalRunId ? [input.previousEvalRunId] : [])];
      const found = await db
        .select({ id: evalRuns.id, taskVersionId: evalRuns.taskVersionId })
        .from(evalRuns)
        .where(inArray(evalRuns.id, runIds));
      const run = found.find((row) => row.id === input.evalRunId);
      if (!run || found.length !== new Set(runIds).size) return "run_not_found";
      const inserted = await db
        .insert(gates)
        .values({
          id: input.id,
          taskVersionId: run.taskVersionId,
          evalRunId: input.evalRunId,
          previousEvalRunId: input.previousEvalRunId,
          passed: input.passed,
          checks: input.checks,
          report: input.report,
        })
        .onConflictDoNothing({ target: gates.id })
        .returning(gateColumns);
      if (inserted[0]) return { value: toGateRecord(slug, inserted[0]), created: true };
      const [existing] = await db.select(gateColumns).from(gates).where(eq(gates.id, input.id));
      return { value: toGateRecord(slug, existing!), created: false };
    },

    upsertReviewItems: async (slug, items) => {
      const target = await currentVersion(slug);
      if (!target) return null;
      const unique = lastByHash(items);
      await db.transaction(async (tx) => {
        const datasetId = await datasetFor(tx, target.taskId, target.versionId, `${slug}-review`);
        for (const batch of chunks(unique)) {
          await tx
            .insert(datasetItems)
            .values(
              batch.map((item) => ({
                datasetId,
                inputHash: item.inputHash,
                input: item.input ?? null,
                source: "rebuild" as const,
                provenance: { pushedBy: "modelstill push" },
                teacherOutputs: item.teacherOutputs ?? null,
                agreement: item.agreement,
                reviewState: item.reviewState,
              })),
            )
            .onConflictDoUpdate({
              target: [datasetItems.datasetId, datasetItems.inputHash],
              set: {
                input: sql`excluded.input`,
                teacherOutputs: sql`excluded.teacher_outputs`,
                agreement: sql`excluded.agreement`,
                reviewState: sql`case when ${datasetItems.reviewState} in ('accepted', 'corrected') then ${datasetItems.reviewState} else excluded.review_state end`,
              },
            });
        }
      });
      return unique.length;
    },

    setDeployment: async (slug, input) => {
      const [task] = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.slug, slug));
      if (!task) return null;
      const [row] = await db
        .insert(deployments)
        .values({
          taskId: task.id,
          mode: input.mode,
          studentModel: input.studentModel,
          threshold: input.threshold,
          targetError: input.targetError,
          shadowSample: input.shadowSample,
          ...(input.activeFrom ? { activeFrom: new Date(input.activeFrom) } : {}),
        })
        .returning(deploymentColumns);
      return toDeployment(row!);
    },

    recordCanaries: async (slug, runs) => {
      const [task] = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.slug, slug));
      if (!task) return null;
      let recorded = 0;
      await db.transaction(async (tx) => {
        for (const batch of chunks(runs)) {
          const inserted = await tx
            .insert(canaryRuns)
            .values(
              batch.map(({ id, createdAt, ...run }) => ({
                ...(id ? { id: canonicalUuid(id) } : {}),
                taskId: task.id,
                ...run,
                createdAt: new Date(createdAt),
              })),
            )
            .onConflictDoNothing({ target: canaryRuns.id })
            .returning({ id: canaryRuns.id });
          recorded += inserted.length;
        }
      });
      return recorded;
    },

    recordAlerts: async (slug, rows) => {
      const [task] = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.slug, slug));
      if (!task) return null;
      let recorded = 0;
      await db.transaction(async (tx) => {
        for (const batch of chunks(rows)) {
          const inserted = await tx
            .insert(alerts)
            .values(
              batch.map(({ id, createdAt, ...alert }) => ({
                ...(id ? { id: canonicalUuid(id) } : {}),
                taskId: task.id,
                ...alert,
                createdAt: new Date(createdAt),
              })),
            )
            .onConflictDoNothing({ target: alerts.id })
            .returning({ id: alerts.id });
          recorded += inserted.length;
        }
      });
      return recorded;
    },

    upsertTrainRun: async (slug, key, input) =>
      db.transaction(async (tx) => {
        const [stored] = await tx.select().from(trainRuns).where(eq(trainRuns.key, key)).for("update");
        if (stored && stored.taskSlug !== slug) return "task_mismatch" as const;
        const merged = mergeTrainRun(slug, key, input, stored ? toTrainRun(stored) : null);
        const values = {
          ...merged,
          startedAt: new Date(merged.startedAt),
          finishedAt: merged.finishedAt ? new Date(merged.finishedAt) : null,
        };
        const [row] = await tx
          .insert(trainRuns)
          .values(values)
          .onConflictDoUpdate({ target: trainRuns.key, set: values })
          .returning();
        return toTrainRun(row!);
      }),

    recordTrainMetrics: async (key, points) => {
      const [run] = await db.select({ key: trainRuns.key }).from(trainRuns).where(eq(trainRuns.key, key));
      if (!run) return null;
      const unique = lastPerStepAndName(points);
      await db.transaction(async (tx) => {
        for (const batch of chunks(unique)) {
          await tx
            .insert(trainMetrics)
            .values(batch.map((point) => ({ runKey: key, ...point })))
            .onConflictDoUpdate({
              target: [trainMetrics.runKey, trainMetrics.step, trainMetrics.name],
              set: { epoch: sql`excluded.epoch`, value: sql`excluded.value` },
            });
        }
      });
      return unique.length;
    },

    listTrainRuns: async (slug) => {
      const rows = await db
        .select()
        .from(trainRuns)
        .where(eq(trainRuns.taskSlug, slug))
        .orderBy(desc(trainRuns.startedAt), asc(trainRuns.key))
        .limit(LIST_LIMIT);
      return rows.map(toTrainRun);
    },

    getTrainRun: async (key) => {
      const [row] = await db.select().from(trainRuns).where(eq(trainRuns.key, key));
      if (!row) return null;
      const points = await db
        .select({ step: trainMetrics.step, epoch: trainMetrics.epoch, name: trainMetrics.name, value: trainMetrics.value })
        .from(trainMetrics)
        .where(eq(trainMetrics.runKey, key))
        .orderBy(asc(trainMetrics.name), asc(trainMetrics.step));
      return { run: toTrainRun(row), series: groupSeries(points) };
    },
  };
}
