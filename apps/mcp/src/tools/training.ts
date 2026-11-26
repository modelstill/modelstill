import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { Api } from "../upstream.ts";
import { bodyOf, listOf, TASK_NOT_FOUND } from "./json.ts";
import { READ_HINTS, registerApiTool } from "./register.ts";
import { SeriesSummary, TrainRun, limitArg, newest, taskArg } from "./schemas.ts";

const DEFAULT_LIMIT = 20;

interface Point {
  step: number;
  value: number;
}

type Better = "lower" | "higher" | null;

const LOWER_IS_BETTER = /loss|error|perplexity|ppl/i;
const HIGHER_IS_BETTER = /reward|acc|f1|score|precision|recall|exact/i;

export function betterOf(name: string): Better {
  if (LOWER_IS_BETTER.test(name)) return "lower";
  if (HIGHER_IS_BETTER.test(name)) return "higher";
  return null;
}

function pointsOf(series: unknown): Point[] {
  if (!Array.isArray(series)) return [];
  return series
    .map((entry) => bodyOf(entry))
    .filter((entry) => typeof entry["step"] === "number" && typeof entry["value"] === "number")
    .map((entry) => ({ step: entry["step"] as number, value: entry["value"] as number }))
    .sort((left, right) => left.step - right.step);
}

function bestOf(points: Point[], better: Better): Point | null {
  if (!better) return null;
  return points.reduce((best, point) =>
    (better === "lower" ? point.value < best.value : point.value > best.value) ? point : best,
  );
}

export function summariseSeries(series: Record<string, unknown>) {
  const summaries: Record<string, z.infer<typeof SeriesSummary>> = {};
  for (const [name, raw] of Object.entries(series)) {
    const points = pointsOf(raw);
    if (points.length === 0) continue;
    const better = betterOf(name);
    summaries[name] = { points: points.length, first: points[0]!, last: points.at(-1)!, best: bestOf(points, better), better };
  }
  return summaries;
}

export function registerTrainingTools(server: McpServer, api: Api): void {
  registerApiTool(server, {
    name: "list_train_runs",
    title: "List training runs",
    description:
      "Lists a task's training runs, newest first: run key, base model, method (for example sft or grpo), status (running, succeeded or failed), final metrics, and start and finish times. Use it to find a run key for get_train_run.",
    input: { task: taskArg, limit: limitArg(100, DEFAULT_LIMIT) },
    output: { runs: z.array(TrainRun), total: z.number() },
    hints: READ_HINTS,
    steps: { notFound: TASK_NOT_FOUND },
    handler: async (args) => {
      const { items, total } = newest(listOf(await api.listTrainRuns(String(args["task"])), "runs"), args["limit"], DEFAULT_LIMIT);
      return { runs: items, total };
    },
  });

  registerApiTool(server, {
    name: "get_train_run",
    title: "Get training run",
    description:
      "Returns one training run with every logged metric summarised instead of the raw series: for each metric (eval_loss, eval_reward, loss, learning_rate and so on) the number of points, the first and last value with their step, and the best value with its step, lowest for losses and highest for rewards and accuracies (null for metrics such as learning rate with no better direction). Use it to tell whether a run converged, overfit (eval loss best well before the last step) or is still improving.",
    input: { key: z.string().min(1).describe("The training run key, from list_train_runs.") },
    output: { run: TrainRun, metrics: z.record(z.string(), SeriesSummary) },
    hints: READ_HINTS,
    steps: { notFound: "No training run has that key. Call list_train_runs for the task to get run keys." },
    handler: async (args) => {
      const body = bodyOf(await api.getTrainRun(String(args["key"])));
      return { run: body["run"], metrics: summariseSeries(bodyOf(body["series"])) };
    },
  });
}
