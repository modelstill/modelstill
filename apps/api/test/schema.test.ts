import { describe, expect, test } from "bun:test";
import { getTableColumns, getTableName } from "drizzle-orm";
import * as schema from "../src/db/schema.ts";

function columns(table: Parameters<typeof getTableColumns>[0]) {
  return Object.values(getTableColumns(table)).map((column) => column.name);
}

describe("schema", () => {
  test("every planned table exists", () => {
    const names = [
      schema.tasks,
      schema.taskVersions,
      schema.datasets,
      schema.datasetItems,
      schema.reviews,
      schema.splits,
      schema.stepCache,
      schema.trainingRuns,
      schema.adapters,
      schema.evalRuns,
      schema.evalScores,
      schema.gates,
      schema.deployments,
      schema.canaryRuns,
      schema.alerts,
    ].map((table) => getTableName(table));
    expect(names).toEqual([
      "tasks",
      "task_versions",
      "datasets",
      "dataset_items",
      "reviews",
      "splits",
      "step_cache",
      "training_runs",
      "adapters",
      "eval_runs",
      "eval_scores",
      "gates",
      "deployments",
      "canary_runs",
      "alerts",
    ]);
  });

  test("dataset items keep provenance, every teacher's answer and review state", () => {
    expect(columns(schema.datasetItems)).toEqual(
      expect.arrayContaining([
        "input_hash",
        "provenance",
        "teacher_outputs",
        "agreement",
        "review_state",
        "final_output_hash",
      ]),
    );
  });

  test("adapters record an immutable path and both precisions", () => {
    expect(columns(schema.adapters)).toEqual(
      expect.arrayContaining(["path", "train_dtype", "serve_dtype"]),
    );
  });

  test("training runs freeze their manifest and pinned library versions", () => {
    expect(columns(schema.trainingRuns)).toEqual(
      expect.arrayContaining(["manifest_hash", "manifest", "seed", "trl_version", "transformers_version"]),
    );
  });

  test("deployments carry the mode, threshold and target error the gateway reads", () => {
    expect(columns(schema.deployments)).toEqual(
      expect.arrayContaining(["mode", "student_model", "threshold", "target_error", "shadow_sample"]),
    );
  });

  test("eval runs keep the engine's model, benchmark, named metrics and primary metric", () => {
    expect(columns(schema.evalRuns)).toEqual(
      expect.arrayContaining(["model", "benchmark_name", "benchmark_version", "metrics", "primary_metric"]),
    );
  });

  test("gates can point at the run they were compared with", () => {
    expect(columns(schema.gates)).toEqual(expect.arrayContaining(["previous_eval_run_id"]));
  });

  test("train runs are keyed by served name and keep their metric points per step", () => {
    expect(getTableName(schema.trainRuns)).toBe("train_runs");
    expect(columns(schema.trainRuns)).toEqual([
      "key",
      "task_slug",
      "base",
      "method",
      "status",
      "manifest",
      "attestation",
      "final_metrics",
      "started_at",
      "finished_at",
    ]);
    expect(getTableName(schema.trainMetrics)).toBe("train_metrics");
    expect(columns(schema.trainMetrics)).toEqual(["run_key", "step", "epoch", "name", "value", "created_at"]);
  });

  test("auth keeps users, sessions, API keys and MCP OAuth grants under the auth_ prefix", () => {
    expect(Object.values(schema.authSchema).map((table) => getTableName(table))).toEqual([
      "auth_user",
      "auth_session",
      "auth_account",
      "auth_verification",
      "auth_apikey",
      "auth_jwks",
      "auth_oauth_application",
      "auth_oauth_access_token",
      "auth_oauth_consent",
    ]);
    expect(Object.keys(schema.authSchema)).toEqual([
      "user",
      "session",
      "account",
      "verification",
      "apikey",
      "jwks",
      "oauthApplication",
      "oauthAccessToken",
      "oauthConsent",
    ]);
    expect(columns(schema.authApikey)).toEqual(expect.arrayContaining(["config_id", "reference_id", "key", "permissions"]));
    expect(columns(schema.authOauthAccessToken)).toEqual(
      expect.arrayContaining(["access_token", "refresh_token", "client_id", "user_id", "scopes"]),
    );
  });

  test("case datasets keep every version and every row revision, keyed so nothing is rewritten", () => {
    expect(getTableName(schema.caseDatasets)).toBe("case_datasets");
    expect(columns(schema.caseDatasetVersions)).toEqual(
      expect.arrayContaining(["dataset_id", "number", "hash", "parent", "row_count", "change", "author", "created_at"]),
    );
    expect(columns(schema.caseRows)).toEqual(
      expect.arrayContaining(["dataset_id", "row_id", "version", "position", "deleted", "input", "expected", "metadata", "author"]),
    );
  });

  test("gates keep every check and the full report", () => {
    expect(columns(schema.gates)).toEqual(expect.arrayContaining(["passed", "checks", "report"]));
  });
});
