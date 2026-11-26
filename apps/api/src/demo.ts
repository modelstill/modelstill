import { sql } from "drizzle-orm";
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
  splits,
  taskVersions,
  tasks,
  trainingRuns,
} from "./db/schema.ts";
import { contentHash } from "./hash.ts";
import { clopperPearson, compareScores, seededRandom, summarizeScores, type CaseScore } from "./stats.ts";

export const DEMO_SLUG = "technographics";
export const DEMO_CASES = 307;
export const DEMO_QUEUED = 20;

const TEACHERS = ["teacher-gpt-4.1", "teacher-gemini-2.5-pro"] as const;
const JUDGE = "judge-claude-sonnet-4.5";
const CLOUD_ALIAS = "cloud-gpt-4.1-mini";
const DAY = 86_400_000;
const HOUR = 3_600_000;

const TECHNOLOGIES = [
  "postgres",
  "kafka",
  "snowflake",
  "dbt",
  "airflow",
  "react",
  "kubernetes",
  "terraform",
  "redis",
  "spark",
  "clickhouse",
  "datadog",
  "segment",
  "stripe",
  "salesforce",
  "hubspot",
];
const PREFIXES = ["Brightline", "Cobalt", "Harbor", "Juniper", "Meridian", "Northgate", "Quarry", "Sable", "Tidewater", "Vantage"];
const SUFFIXES = ["Analytics", "Logistics", "Health", "Robotics", "Foods", "Energy", "Labs", "Freight"];
const ROLES = ["data engineer", "platform engineer", "backend developer", "analytics engineer", "SRE"];

type SyntheticCase = { input: { company: string; posting: string }; expected: string[]; inputHash: string };

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)]!;
}

function pickSet(random: () => number, size: number): string[] {
  const chosen = new Set<string>();
  while (chosen.size < size) chosen.add(pick(random, TECHNOLOGIES));
  return [...chosen].sort();
}

function syntheticCase(random: () => number, index: number): SyntheticCase {
  const company = `${pick(random, PREFIXES)} ${pick(random, SUFFIXES)} ${index + 1}`;
  const expected = pickSet(random, 1 + Math.floor(random() * 4));
  const posting = `${company} is hiring a ${pick(random, ROLES)} to work with ${expected.join(", ")}.`;
  const input = { company, posting };
  return { input, expected, inputHash: contentHash(input) };
}

function perturb(random: () => number, expected: string[]): string[] {
  const kept = expected.filter(() => random() > 0.25);
  if (random() < 0.3) kept.push(pick(random, TECHNOLOGIES));
  return [...new Set(kept)].sort();
}

function scoreRun(difficulty: readonly number[], skill: number, seed: number, cases: SyntheticCase[]): CaseScore[] {
  const random = seededRandom(seed);
  return cases.map((entry, index) => {
    const draw = 0.6 * difficulty[index]! + 0.4 * random();
    const score = draw < skill ? 1 : draw < skill + 0.12 ? 0.5 : 0;
    return { inputHash: entry.inputHash, score };
  });
}

function check(name: string, threshold: number, value: number) {
  return { name, threshold, value, passed: value >= threshold };
}

export async function removeTask(db: Executor, slug: string) {
  const versionIds = sql`(select tv.id from task_versions tv join tasks t on t.id = tv.task_id where t.slug = ${slug})`;
  const taskId = sql`(select id from tasks where slug = ${slug})`;
  const datasetIds = sql`(select id from datasets where task_version_id in ${versionIds})`;
  const runIds = sql`(select id from training_runs where task_version_id in ${versionIds})`;
  await db.execute(sql`delete from reviews where item_id in (select id from dataset_items where dataset_id in ${datasetIds})`);
  await db.execute(sql`delete from eval_scores where eval_run_id in (select id from eval_runs where task_version_id in ${versionIds})`);
  await db.execute(sql`delete from gates where task_version_id in ${versionIds}`);
  await db.execute(sql`delete from deployments where task_id = ${taskId}`);
  await db.execute(sql`delete from eval_runs where task_version_id in ${versionIds}`);
  await db.execute(sql`delete from adapters where training_run_id in ${runIds}`);
  await db.execute(sql`delete from training_runs where task_version_id in ${versionIds}`);
  await db.execute(sql`delete from splits where dataset_id in ${datasetIds}`);
  await db.execute(sql`delete from dataset_items where dataset_id in ${datasetIds}`);
  await db.execute(sql`delete from datasets where task_version_id in ${versionIds}`);
  const caseDatasetIds = sql`(select id from case_datasets where task_id = ${taskId})`;
  await db.execute(sql`delete from case_rows where dataset_id in ${caseDatasetIds}`);
  await db.execute(sql`delete from case_dataset_versions where dataset_id in ${caseDatasetIds}`);
  await db.execute(sql`delete from case_datasets where task_id = ${taskId}`);
  await db.execute(sql`delete from canary_runs where task_id = ${taskId}`);
  await db.execute(sql`delete from alerts where task_id = ${taskId}`);
  await db.execute(sql`delete from task_versions where task_id = ${taskId}`);
  await db.execute(sql`delete from tasks where slug = ${slug}`);
}

type SeedOptions = { slug?: string; now?: Date };

type InsertedRun = {
  run: { id: string };
  summary: ReturnType<typeof summarizeScores>;
  scores: CaseScore[];
};

export async function seedDemo(db: Database, { slug = DEMO_SLUG, now = new Date() }: SeedOptions = {}) {
  const at = (offset: number) => new Date(now.getTime() - offset);
  const random = seededRandom(42);
  const cases = Array.from({ length: DEMO_CASES }, (_, index) => syntheticCase(random, index));
  const queued = Array.from({ length: DEMO_QUEUED }, (_, index) => syntheticCase(random, DEMO_CASES + index));
  const difficulty = cases.map(() => random());
  const cloudScores = scoreRun(difficulty, 0.62, 1, cases);
  const firstScores = scoreRun(difficulty, 0.47, 2, cases);
  const secondScores = scoreRun(difficulty, 0.6, 3, cases);

  await db.transaction(async (tx) => {
    await removeTask(tx, slug);
    const [task] = await tx.insert(tasks).values({ slug, owner: "demo", createdAt: at(21 * DAY) }).returning();
    const [first, second] = await tx
      .insert(taskVersions)
      .values([
        { taskId: task!.id, version: 1, snapshotHash: contentHash({ slug, version: 1 }).slice(0, 12), spec: { slug, metric: "set_f1", labels: "technologies" }, gitSha: "4a36fc3", createdAt: at(20 * DAY) },
        { taskId: task!.id, version: 2, snapshotHash: contentHash({ slug, version: 2 }).slice(0, 12), spec: { slug, metric: "set_f1", labels: "technologies", synonyms: true }, gitSha: "dc33089", createdAt: at(8 * DAY) },
      ])
      .returning();
    await tx.update(tasks).set({ currentVersionId: second!.id }).where(sql`${tasks.id} = ${task!.id}`);

    const [gold, gateway] = await tx
      .insert(datasets)
      .values([
        { taskVersionId: first!.id, name: `${slug}-gold`, createdAt: at(20 * DAY) },
        { taskVersionId: second!.id, name: `${slug}-gateway-deferrals`, createdAt: at(5 * DAY) },
      ])
      .returning();

    await tx.insert(datasetItems).values(
      cases.map((entry, index) => ({
        datasetId: gold!.id,
        inputHash: entry.inputHash,
        input: entry.input,
        source: "golden" as const,
        provenance: { generator: "seed-demo", synthetic: true, index },
        teacherOutputs: { [TEACHERS[0]]: entry.expected, [TEACHERS[1]]: entry.expected },
        agreement: true,
        reviewState: "accepted" as const,
        finalOutput: entry.expected,
        finalOutputHash: contentHash(entry.expected),
        createdAt: at(20 * DAY),
      })),
    );
    await tx.insert(splits).values(
      cases.map((entry) => ({ datasetId: gold!.id, version: 1, inputHash: entry.inputHash, split: "gold" as const })),
    );
    await tx.insert(datasetItems).values(
      queued.map((entry, index) => ({
        datasetId: gateway!.id,
        inputHash: entry.inputHash,
        input: entry.input,
        source: "gateway" as const,
        provenance: { generator: "seed-demo", synthetic: true, deferred: true },
        teacherOutputs: { [TEACHERS[0]]: entry.expected, [TEACHERS[1]]: perturb(random, entry.expected) },
        agreement: false,
        reviewState: "queued" as const,
        createdAt: at(4 * DAY - index * HOUR),
      })),
    );

    const runs = await tx
      .insert(trainingRuns)
      .values(
        [first!, second!].map((version, index) => ({
          taskVersionId: version.id,
          datasetId: gold!.id,
          splitVersion: 1,
          manifestHash: contentHash({ slug, run: index + 1 }),
          manifest: { slug, run: index + 1, synthetic: true },
          seed: index,
          base: "Qwen/Qwen3-1.7B",
          trlVersion: "0.19.1",
          transformersVersion: "4.53.2",
          config: { lora_r: 16, epochs: 3, learning_rate: 0.0002 },
          status: "succeeded" as const,
          createdAt: at((16 - index * 9) * DAY),
        })),
      )
      .returning();
    const [firstAdapter, secondAdapter] = await tx
      .insert(adapters)
      .values(
        runs.map((run, index) => ({
          trainingRunId: run.id,
          path: `s3://modelstill-demo/adapters/${slug}/v${index + 1}/${run.manifestHash.slice(0, 12)}`,
          servedName: `${slug}-v${index + 1}`,
          trainDtype: "bf16",
          serveDtype: "bf16",
          createdAt: at((15 - index * 9) * DAY),
        })),
      )
      .returning();

    const runSpecs = [
      { version: first!, adapterId: null, cloudAlias: CLOUD_ALIAS, scores: cloudScores, createdAt: at(18 * DAY) },
      { version: first!, adapterId: firstAdapter!.id, cloudAlias: null, scores: firstScores, createdAt: at(15 * DAY) },
      { version: second!, adapterId: secondAdapter!.id, cloudAlias: null, scores: secondScores, createdAt: at(6 * DAY) },
    ];
    const insertedRuns: InsertedRun[] = [];
    for (const spec of runSpecs) {
      const summary = summarizeScores(spec.scores.map((entry) => entry.score));
      const [run] = await tx
        .insert(evalRuns)
        .values({
          taskVersionId: spec.version.id,
          adapterId: spec.adapterId,
          cloudAlias: spec.cloudAlias,
          datasetId: gold!.id,
          split: "gold",
          judgeModel: JUDGE,
          summary,
          createdAt: spec.createdAt,
        })
        .returning();
      await tx.insert(evalScores).values(
        spec.scores.map((entry) => ({
          evalRunId: run!.id,
          inputHash: entry.inputHash,
          output: {},
          metrics: { score: entry.score },
          judgeScore: entry.score,
        })),
      );
      insertedRuns.push({ run: run!, summary, scores: spec.scores });
    }

    const [, firstRun, secondRun] = insertedRuns;
    const gateChecks = (run: InsertedRun, kappa: number) => [
      check("metric_lower_bound", 0.68, run.summary.low),
      check("paired_difference_vs_cloud_lower_bound", -0.12, compareScores(cloudScores, run.scores).low),
      check("judge_human_kappa", 0.6, kappa),
    ];
    for (const [run, version, kappa, createdAt] of [
      [firstRun!, first!, 0.71, at(15 * DAY - HOUR)],
      [secondRun!, second!, 0.74, at(6 * DAY - HOUR)],
    ] as const) {
      const checks = gateChecks(run, kappa);
      await tx.insert(gates).values({
        taskVersionId: version.id,
        evalRunId: run.run.id,
        passed: checks.every((entry) => entry.passed),
        checks,
        report: { summary: run.summary, synthetic: true },
        createdAt,
      });
    }

    await tx.insert(deployments).values({
      taskId: task!.id,
      adapterId: secondAdapter!.id,
      mode: "shadow",
      studentModel: secondAdapter!.servedName,
      shadowSample: 0.1,
      threshold: 0.82,
      targetError: 0.05,
      activeFrom: at(5 * DAY),
      createdAt: at(5 * DAY),
    });

    const canaryValues = [];
    for (let slot = 0; slot < 10; slot += 1) {
      for (const provider of ["cloud-openai", "student-vllm"]) {
        const total = 50;
        const passed = provider === "student-vllm" && slot === 1 ? 41 : 46 + Math.floor(random() * 5);
        canaryValues.push({ taskId: task!.id, provider, passed, total, ...clopperPearson(passed, total), createdAt: at(slot * 12 * HOUR + HOUR) });
      }
    }
    await tx.insert(canaryRuns).values(canaryValues);

    await tx.insert(alerts).values([
      { taskId: task!.id, kind: "canary_drop", severity: "warning", payload: { provider: "student-vllm", passed: 41, total: 50 }, createdAt: at(13 * HOUR) },
      { taskId: task!.id, kind: "deferral_spike", severity: "info", payload: { deferralShare: 0.31, window: "1h" }, ackedAt: at(3 * DAY), createdAt: at(4 * DAY) },
    ]);
  });
}

export function demoServingEvents(slug: string, now: Date, hours = 24) {
  const random = seededRandom(7);
  const events = [];
  for (let hour = hours - 1; hour >= 0; hour -= 1) {
    const calls = 40 + Math.floor(random() * 40);
    for (let call = 0; call < calls; call += 1) {
      const ts = new Date(now.getTime() - hour * HOUR - Math.floor(random() * HOUR));
      const confidence = random();
      const deferred = confidence < 0.18;
      const mismatch = !deferred && random() < 0.01;
      events.push({
        ts: ts.toISOString().replace("T", " ").replace("Z", ""),
        task: slug,
        deployment_id: "demo",
        request_hash: contentHash({ slug, hour, call }).slice(0, 16),
        mode: "shadow",
        served_from: deferred || mismatch ? "cloud" : "student",
        deferred: deferred || mismatch,
        reason: deferred ? "low_confidence" : mismatch ? "model_mismatch" : null,
        confidence,
        student_model: `${slug}-v2`,
        model_match: !mismatch,
        student_output: null,
        cloud_model: CLOUD_ALIAS,
        cloud_output: null,
        student_ms: 60 + random() * 120,
        cloud_ms: random() < 0.1 || deferred ? 500 + random() * 900 : null,
        student_cost_usd: 0.00002,
        cloud_cost_usd: deferred ? 0.0011 : null,
      });
    }
  }
  return events;
}
