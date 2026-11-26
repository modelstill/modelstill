import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerEvalTools } from "./tools/evals.ts";
import { registerReviewTools } from "./tools/review.ts";
import { registerServingTools } from "./tools/serving.ts";
import { registerTaskTools } from "./tools/tasks.ts";
import { registerTrainingTools } from "./tools/training.ts";
import type { Api } from "./upstream.ts";

export const SERVER_INSTRUCTIONS = [
  "ModelStill distils a task that a cloud model answers today into a small student model, gates it with statistics, and serves it with deferral back to the cloud model.",
  "Every tool takes a task slug except compare_runs, decide_review_item and get_train_run: call list_tasks first to find slugs.",
  "get_task shows a task's versions. list_eval_runs gives scores with 95% intervals, compare_runs pairs two runs case by case (difference with interval, fixed and broken), and list_gates shows every gate check with its threshold and measured value.",
  "get_review_queue lists items waiting for a human, and decide_review_item records an accept or a correction.",
  "get_deployment, get_traffic, list_canaries and list_alerts describe serving: the mode (off, shadow or serve), hourly traffic served by the student or deferred, provider canaries and open alerts.",
  "list_train_runs and get_train_run show training runs with first, last and best eval loss or reward.",
  'The two write tools, decide_review_item and set_deployment_mode, change real state and are never retried: call them only when the user asked for that change. Rollback is set_deployment_mode with mode "off".',
  "A failed call answers isError with error, message, next_step and retryable; follow next_step.",
].join(" ");

export function buildMcpServer(api: Api): McpServer {
  const server = new McpServer({ name: "modelstill", version: "0.1.0" }, { instructions: SERVER_INSTRUCTIONS });
  registerTaskTools(server, api);
  registerEvalTools(server, api);
  registerReviewTools(server, api);
  registerServingTools(server, api);
  registerTrainingTools(server, api);
  return server;
}
