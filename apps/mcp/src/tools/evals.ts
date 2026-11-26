import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { Api } from "../upstream.ts";
import { READ_HINTS, registerApiTool } from "./register.ts";
import { EvalRun, GateRecord, limitArg, newest, taskArg } from "./schemas.ts";
import { bodyOf, listOf, TASK_NOT_FOUND } from "./json.ts";

const DEFAULT_LIMIT = 20;

export function registerEvalTools(server: McpServer, api: Api): void {
  registerApiTool(server, {
    name: "list_eval_runs",
    title: "List eval runs",
    description:
      "Lists a task's eval runs, newest first. Each run names the model, the split (usually gold), the judge model, the number of cases, and the mean score with its 95% interval, plus every named metric with its own interval. Use it to find run ids for compare_runs or to see how scores moved over time.",
    input: { task: taskArg, limit: limitArg(100, DEFAULT_LIMIT) },
    output: { runs: z.array(EvalRun), total: z.number() },
    hints: READ_HINTS,
    steps: { notFound: TASK_NOT_FOUND },
    handler: async (args) => {
      const { items, total } = newest(listOf(await api.listEvalRuns(String(args["task"])), "runs"), args["limit"], DEFAULT_LIMIT);
      return { runs: items, total };
    },
  });

  registerApiTool(server, {
    name: "compare_runs",
    title: "Compare two eval runs",
    description:
      "Compares two eval runs of the same task case by case. Returns both runs, the paired difference (after minus before) with its seeded 95% bootstrap interval, a verdict (better, worse or no_detectable_difference), how many cases the after run fixed and how many it broke, and how many cases were paired. Use it before promoting a new model: a difference whose interval includes zero is not a real change.",
    input: {
      before: z.string().min(1).describe("Id of the baseline eval run, from list_eval_runs."),
      after: z.string().min(1).describe("Id of the candidate eval run, from list_eval_runs."),
    },
    output: {
      before: EvalRun,
      after: EvalRun,
      difference: z.number(),
      low: z.number(),
      high: z.number(),
      verdict: z.string(),
      fixed: z.number(),
      broken: z.number(),
      paired_cases: z.number(),
    },
    hints: READ_HINTS,
    steps: {
      notFound: "One of the run ids does not exist. Call list_eval_runs for the task to get valid ids.",
      invalid: "The two runs were not scored on the same cases, so they cannot be paired. Compare runs over the same cases (the same split and snapshot).",
    },
    handler: async (args) => {
      const { cases, ...comparison } = bodyOf(await api.compareRuns(String(args["before"]), String(args["after"])));
      return { ...comparison, paired_cases: Array.isArray(cases) ? cases.length : 0 };
    },
  });

  registerApiTool(server, {
    name: "list_gates",
    title: "List gate decisions",
    description:
      "Lists a task's gate decisions, newest first. Each gate says whether it passed and lists every check with its threshold, the measured value and whether that check passed, so a failed gate shows exactly which check failed and by how much. Use it to answer whether a model was allowed to ship and why.",
    input: { task: taskArg, limit: limitArg(100, DEFAULT_LIMIT) },
    output: { gates: z.array(GateRecord), total: z.number() },
    hints: READ_HINTS,
    steps: { notFound: TASK_NOT_FOUND },
    handler: async (args) => {
      const { items, total } = newest(listOf(await api.listGates(String(args["task"])), "gates"), args["limit"], DEFAULT_LIMIT);
      return { gates: items, total };
    },
  });
}
