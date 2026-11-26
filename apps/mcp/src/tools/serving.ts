import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { Api } from "../upstream.ts";
import { bodyOf, listOf, TASK_NOT_FOUND } from "./json.ts";
import { READ_HINTS, registerApiTool, type ToolArgs } from "./register.ts";
import { ToolRefusal } from "./results.ts";
import { Alert, CanaryRun, Deployment, ServingMode, TrafficBucket, limitArg, newest, taskArg } from "./schemas.ts";

const DEFAULT_LIMIT = 20;
const DEFAULT_HOURS = 24;
const OFF_TARGET_ERROR = 0.05;
const DEFAULT_SHADOW_SAMPLE = 0.1;

export const ROLLBACK = 'To roll back, call set_deployment_mode with mode "off": every call goes to the cloud model again.';

const TRAFFIC_COUNTS = ["total", "served_student", "deferred", "model_mismatch"] as const;

function trafficTotals(buckets: unknown[]): Record<string, number> {
  const totals = Object.fromEntries(TRAFFIC_COUNTS.map((key) => [key, 0]));
  for (const bucket of buckets) {
    const row = bodyOf(bucket);
    for (const key of TRAFFIC_COUNTS) totals[key]! += typeof row[key] === "number" ? row[key] : 0;
  }
  return totals;
}

function pick<T>(args: ToolArgs, key: string, current: T): T {
  return args[key] === undefined ? current : (args[key] as T);
}

function nextDeployment(args: ToolArgs, current: Record<string, unknown> | null): Record<string, unknown> {
  const mode = String(args["mode"]);
  const studentModel = pick(args, "student_model", (current?.["studentModel"] as string | null | undefined) ?? null);
  const threshold = pick(args, "threshold", (current?.["threshold"] as number | null | undefined) ?? null);
  const targetError = pick(args, "target_error", current?.["targetError"] as number | undefined);
  const shadowSample = pick(args, "shadow_sample", (current?.["shadowSample"] as number | undefined) ?? DEFAULT_SHADOW_SAMPLE);
  if (mode !== "off" && !studentModel) {
    throw new ToolRefusal(
      "missing_student_model",
      `The task has no student model, so it cannot run in ${mode} mode.`,
      "Send the call again with student_model set to the student model to route to.",
    );
  }
  if (mode !== "off" && targetError === undefined) {
    throw new ToolRefusal(
      "missing_target_error",
      "The task has no deployment yet, so there is no target error to keep.",
      "Send the call again with target_error, the error rate the deferral threshold is calibrated to (for example 0.05).",
    );
  }
  return { mode, studentModel, threshold, targetError: targetError ?? OFF_TARGET_ERROR, shadowSample, activeFrom: null };
}

export function registerServingTools(server: McpServer, api: Api): void {
  registerApiTool(server, {
    name: "get_deployment",
    title: "Get deployment",
    description:
      "Returns how a task is served right now: mode (off sends every call to the cloud model, shadow runs the student alongside it without serving its answers, serve answers with the student and defers to the cloud model below the threshold), the student model, the confidence threshold, the target error it was calibrated to, the shadow sample rate and when it took effect. deployment is null when the task was never deployed.",
    input: { task: taskArg },
    output: { deployment: Deployment.nullable() },
    hints: READ_HINTS,
    steps: { notFound: TASK_NOT_FOUND },
    handler: async (args) => ({ deployment: bodyOf(await api.getDeployment(String(args["task"])))["deployment"] ?? null }),
  });

  registerApiTool(server, {
    name: "set_deployment_mode",
    title: "Set deployment mode",
    description:
      `Changes how a task is served: mode off, shadow or serve. It reads the current deployment and keeps its student model, threshold, target error and shadow sample unless the call names new ones, then returns the deployment now in effect and the previous mode. Rollback is mode "off": every call goes back to the cloud model. Switching to serve sends real traffic to the student, so only do it when the user asks and the latest gate passed. Never retried automatically.`,
    input: {
      task: taskArg,
      mode: ServingMode.describe("off, shadow or serve. off is the rollback."),
      student_model: z.string().min(1).optional().describe("The student model to route to. Default: the current one."),
      threshold: z.number().min(0).max(1).optional().describe("Confidence threshold below which calls defer to the cloud model. Default: the current one."),
      target_error: z.number().gt(0).lt(1).optional().describe("Error rate the threshold is calibrated to. Default: the current one."),
      shadow_sample: z.number().min(0).max(1).optional().describe("Share of calls run in shadow. Default: the current one, else 0.1."),
    },
    output: { deployment: Deployment, previous_mode: z.string().nullable(), rollback: z.string() },
    hints: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    steps: { notFound: TASK_NOT_FOUND },
    handler: async (args) => {
      const slug = String(args["task"]);
      const current = (bodyOf(await api.getDeployment(slug))["deployment"] ?? null) as Record<string, unknown> | null;
      const updated = bodyOf(await api.setDeployment(slug, nextDeployment(args, current)))["deployment"];
      return { deployment: updated, previous_mode: (current?.["mode"] as string | undefined) ?? null, rollback: ROLLBACK };
    },
  });

  registerApiTool(server, {
    name: "get_traffic",
    title: "Get serving traffic",
    description:
      "Returns a task's serving traffic by hour for the last hours (default 24, at most 720): calls in total, served by the student, deferred to the cloud model, and answered by an unexpected model, with p95 latency for each side. Also returns the deferral share over the window and the totals. Use it to check a shadow or serve rollout.",
    input: {
      task: taskArg,
      hours: z.number().int().min(1).max(720).optional().describe(`How many hours back. Default ${DEFAULT_HOURS}, at most 720.`),
    },
    output: {
      buckets: z.array(TrafficBucket),
      deferralShare: z.number().nullable(),
      totals: z.object({ total: z.number(), served_student: z.number(), deferred: z.number(), model_mismatch: z.number() }),
    },
    hints: READ_HINTS,
    steps: { notFound: TASK_NOT_FOUND },
    handler: async (args) => {
      const hours = typeof args["hours"] === "number" ? args["hours"] : DEFAULT_HOURS;
      const body = bodyOf(await api.traffic(String(args["task"]), hours));
      const buckets = listOf(body, "buckets");
      return { buckets, deferralShare: body["deferralShare"] ?? null, totals: trafficTotals(buckets) };
    },
  });

  registerApiTool(server, {
    name: "list_canaries",
    title: "List canary runs",
    description:
      "Lists a task's canary runs, newest first: which provider was probed, how many canary cases passed out of how many, and the interval on the pass rate. A falling pass rate means a provider changed under the task.",
    input: { task: taskArg, limit: limitArg(100, DEFAULT_LIMIT) },
    output: { runs: z.array(CanaryRun), total: z.number() },
    hints: READ_HINTS,
    steps: { notFound: TASK_NOT_FOUND },
    handler: async (args) => {
      const { items, total } = newest(listOf(await api.listCanaries(String(args["task"])), "runs"), args["limit"], DEFAULT_LIMIT);
      return { runs: items, total };
    },
  });

  registerApiTool(server, {
    name: "list_alerts",
    title: "List alerts",
    description:
      "Lists a task's alerts, newest first: kind (for example drift or canary failure), severity, when it fired, when it was acknowledged (null while open) and the measured payload. Use it to answer whether anything is wrong with a task right now.",
    input: { task: taskArg, limit: limitArg(100, DEFAULT_LIMIT) },
    output: { alerts: z.array(Alert), total: z.number() },
    hints: READ_HINTS,
    steps: { notFound: TASK_NOT_FOUND },
    handler: async (args) => {
      const { items, total } = newest(listOf(await api.listAlerts(String(args["task"])), "alerts"), args["limit"], DEFAULT_LIMIT);
      return { alerts: items, total };
    },
  });
}
