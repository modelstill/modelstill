import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const servingMode = pgEnum("serving_mode", ["off", "shadow", "serve"]);
export const reviewState = pgEnum("review_state", ["none", "queued", "accepted", "corrected"]);
export const reviewKind = pgEnum("review_kind", ["label", "student_disagreement", "ppi_sample"]);
export const splitName = pgEnum("split_name", ["train", "val", "calib", "gold"]);
export const itemSource = pgEnum("item_source", ["langfuse", "rebuild", "gateway", "golden"]);
export const runStatus = pgEnum("run_status", ["queued", "running", "succeeded", "failed"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  owner: text("owner").notNull(),
  currentVersionId: uuid("current_version_id"),
  createdAt: createdAt(),
});

export const taskVersions = pgTable(
  "task_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id),
    version: integer("version").notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    spec: jsonb("spec").notNull(),
    gitSha: text("git_sha").notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("task_versions_hash").on(table.taskId, table.snapshotHash)],
);

export const datasets = pgTable("datasets", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskVersionId: uuid("task_version_id")
    .notNull()
    .references(() => taskVersions.id),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const datasetItems = pgTable(
  "dataset_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    datasetId: uuid("dataset_id")
      .notNull()
      .references(() => datasets.id),
    inputHash: text("input_hash").notNull(),
    input: jsonb("input").notNull(),
    source: itemSource("source").notNull(),
    provenance: jsonb("provenance").notNull(),
    teacherOutputs: jsonb("teacher_outputs").notNull(),
    agreement: boolean("agreement"),
    reviewState: reviewState("review_state").notNull().default("none"),
    finalOutputHash: text("final_output_hash"),
    finalOutput: jsonb("final_output"),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("dataset_items_input").on(table.datasetId, table.inputHash)],
);

export const reviews = pgTable("reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  itemId: uuid("item_id")
    .notNull()
    .references(() => datasetItems.id),
  kind: reviewKind("kind").notNull(),
  reviewer: text("reviewer").notNull(),
  verdict: text("verdict").notNull(),
  correctedOutput: jsonb("corrected_output"),
  createdAt: createdAt(),
});

export const splits = pgTable(
  "splits",
  {
    datasetId: uuid("dataset_id")
      .notNull()
      .references(() => datasets.id),
    version: integer("version").notNull(),
    inputHash: text("input_hash").notNull(),
    split: splitName("split").notNull(),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.datasetId, table.version, table.inputHash] })],
);

export const stepCache = pgTable("step_cache", {
  stepKeyHash: text("step_key_hash").primaryKey(),
  outputRef: jsonb("output_ref").notNull(),
  createdAt: createdAt(),
});

export const trainingRuns = pgTable("training_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskVersionId: uuid("task_version_id")
    .notNull()
    .references(() => taskVersions.id),
  datasetId: uuid("dataset_id")
    .notNull()
    .references(() => datasets.id),
  splitVersion: integer("split_version").notNull(),
  manifestHash: text("manifest_hash").notNull(),
  manifest: jsonb("manifest").notNull(),
  seed: integer("seed").notNull(),
  base: text("base").notNull(),
  trlVersion: text("trl_version").notNull(),
  transformersVersion: text("transformers_version").notNull(),
  config: jsonb("config").notNull(),
  status: runStatus("status").notNull().default("queued"),
  modalCallId: text("modal_call_id"),
  createdAt: createdAt(),
});

export const adapters = pgTable("adapters", {
  id: uuid("id").primaryKey().defaultRandom(),
  trainingRunId: uuid("training_run_id")
    .notNull()
    .references(() => trainingRuns.id),
  path: text("path").notNull().unique(),
  servedName: text("served_name").notNull().unique(),
  trainDtype: text("train_dtype").notNull(),
  serveDtype: text("serve_dtype").notNull(),
  metrics: jsonb("metrics"),
  createdAt: createdAt(),
});

export const evalRuns = pgTable("eval_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskVersionId: uuid("task_version_id")
    .notNull()
    .references(() => taskVersions.id),
  adapterId: uuid("adapter_id").references(() => adapters.id),
  cloudAlias: text("cloud_alias"),
  datasetId: uuid("dataset_id")
    .notNull()
    .references(() => datasets.id),
  split: splitName("split").notNull(),
  judgeModel: text("judge_model").notNull(),
  summary: jsonb("summary"),
  model: text("model"),
  benchmarkName: text("benchmark_name"),
  benchmarkVersion: text("benchmark_version"),
  metrics: jsonb("metrics"),
  primaryMetric: text("primary_metric"),
  createdAt: createdAt(),
});

export const evalScores = pgTable(
  "eval_scores",
  {
    evalRunId: uuid("eval_run_id")
      .notNull()
      .references(() => evalRuns.id),
    inputHash: text("input_hash").notNull(),
    output: jsonb("output").notNull(),
    metrics: jsonb("metrics").notNull(),
    input: jsonb("input"),
    expected: jsonb("expected"),
    judgeScore: doublePrecision("judge_score"),
    humanScore: doublePrecision("human_score"),
  },
  (table) => [primaryKey({ columns: [table.evalRunId, table.inputHash] })],
);

export const gates = pgTable("gates", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskVersionId: uuid("task_version_id")
    .notNull()
    .references(() => taskVersions.id),
  evalRunId: uuid("eval_run_id")
    .notNull()
    .references(() => evalRuns.id),
  previousAdapterId: uuid("previous_adapter_id").references(() => adapters.id),
  previousEvalRunId: uuid("previous_eval_run_id").references(() => evalRuns.id),
  passed: boolean("passed").notNull(),
  checks: jsonb("checks").notNull(),
  report: jsonb("report").notNull(),
  createdAt: createdAt(),
});

export const deployments = pgTable("deployments", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => tasks.id),
  adapterId: uuid("adapter_id").references(() => adapters.id),
  mode: servingMode("mode").notNull().default("off"),
  studentModel: text("student_model"),
  shadowSample: doublePrecision("shadow_sample").notNull().default(0.1),
  threshold: doublePrecision("threshold"),
  targetError: doublePrecision("target_error").notNull(),
  activeFrom: timestamp("active_from", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
});

export const canaryRuns = pgTable("canary_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => tasks.id),
  provider: text("provider").notNull(),
  passed: integer("passed").notNull(),
  total: integer("total").notNull(),
  low: doublePrecision("low").notNull(),
  high: doublePrecision("high").notNull(),
  createdAt: createdAt(),
});

export const alerts = pgTable("alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").references(() => tasks.id),
  kind: text("kind").notNull(),
  severity: text("severity").notNull(),
  payload: jsonb("payload").notNull(),
  sentTo: text("sent_to"),
  ackedAt: timestamp("acked_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const trainRuns = pgTable(
  "train_runs",
  {
    key: text("key").primaryKey(),
    taskSlug: text("task_slug").notNull(),
    base: text("base").notNull(),
    method: text("method").notNull(),
    status: text("status").notNull(),
    manifest: jsonb("manifest"),
    attestation: jsonb("attestation"),
    finalMetrics: jsonb("final_metrics"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    check("train_runs_status", sql`${table.status} in ('running', 'succeeded', 'failed')`),
    index("train_runs_task_started").on(table.taskSlug, table.startedAt),
  ],
);

export const trainMetrics = pgTable(
  "train_metrics",
  {
    runKey: text("run_key")
      .notNull()
      .references(() => trainRuns.key, { onDelete: "cascade" }),
    step: integer("step").notNull(),
    epoch: doublePrecision("epoch"),
    name: text("name").notNull(),
    value: doublePrecision("value").notNull(),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.runKey, table.step, table.name] })],
);

export const caseDatasets = pgTable(
  "case_datasets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("case_datasets_task_name").on(table.taskId, table.name)],
);

export const caseDatasetVersions = pgTable(
  "case_dataset_versions",
  {
    datasetId: uuid("dataset_id")
      .notNull()
      .references(() => caseDatasets.id),
    number: integer("number").notNull(),
    hash: text("hash").notNull(),
    parent: integer("parent"),
    rowCount: integer("row_count").notNull(),
    change: jsonb("change").notNull(),
    author: text("author"),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.datasetId, table.number] })],
);

export const caseRows = pgTable(
  "case_rows",
  {
    datasetId: uuid("dataset_id")
      .notNull()
      .references(() => caseDatasets.id),
    rowId: text("row_id").notNull(),
    version: integer("version").notNull(),
    position: integer("position").notNull(),
    deleted: boolean("deleted").notNull().default(false),
    input: jsonb("input"),
    expected: jsonb("expected"),
    metadata: jsonb("metadata").notNull(),
    author: text("author"),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.datasetId, table.rowId, table.version] }),
    index("case_rows_dataset_version").on(table.datasetId, table.version),
  ],
);

export * from "./auth-schema.ts";
