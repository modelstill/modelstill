import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { Api } from "../upstream.ts";
import { listOf, bodyOf, TASK_NOT_FOUND } from "./json.ts";
import { READ_HINTS, registerApiTool } from "./register.ts";
import { ToolRefusal } from "./results.ts";
import { ReviewItem, taskArg } from "./schemas.ts";

const DEFAULT_QUEUE_LIMIT = 20;
export const DEFAULT_REVIEWER = "modelstill-mcp";

export function registerReviewTools(server: McpServer, api: Api): void {
  registerApiTool(server, {
    name: "get_review_queue",
    title: "Get review queue",
    description:
      "Returns the dataset items of a task waiting for a human decision: each item's id, input, the teacher models' outputs, whether the teachers agreed, and its review state. Use it to find items to accept or correct with decide_review_item.",
    input: {
      task: taskArg,
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe(`How many queued items to return. Default ${DEFAULT_QUEUE_LIMIT}, at most 500.`),
    },
    output: { items: z.array(ReviewItem) },
    hints: READ_HINTS,
    steps: { notFound: TASK_NOT_FOUND },
    handler: async (args) => {
      const limit = typeof args["limit"] === "number" ? args["limit"] : DEFAULT_QUEUE_LIMIT;
      return { items: listOf(await api.reviewQueue(String(args["task"]), limit), "items") };
    },
  });

  registerApiTool(server, {
    name: "decide_review_item",
    title: "Decide a review item",
    description:
      "Records a human decision on one queued review item and returns the item as stored. verdict accept keeps the teachers' label; verdict correct replaces it with corrected_output, which becomes training data. A new decision replaces any earlier one on the item. Only call it when the user has made the decision; this tool is never retried automatically.",
    input: {
      item_id: z.string().min(1).describe("The review item id, from get_review_queue."),
      verdict: z.enum(["accept", "correct"]).describe("accept keeps the teachers' output; correct replaces it."),
      corrected_output: z
        .unknown()
        .optional()
        .describe("The right output for the item, in the task's output shape. Required when verdict is correct."),
      reviewer: z
        .string()
        .min(1)
        .optional()
        .describe(`Who made the decision, for the audit trail. Default ${DEFAULT_REVIEWER}.`),
    },
    output: { item: ReviewItem },
    hints: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    steps: { notFound: "No review item has that id. Call get_review_queue for the task to get current item ids." },
    handler: async (args) => {
      const reviewer = typeof args["reviewer"] === "string" ? args["reviewer"] : DEFAULT_REVIEWER;
      if (args["verdict"] === "accept") {
        return { item: bodyOf(await api.decideReview(String(args["item_id"]), { verdict: "accept", reviewer }))["item"] };
      }
      if (args["corrected_output"] === undefined) {
        throw new ToolRefusal(
          "missing_corrected_output",
          "A correction needs the corrected output.",
          "Send the call again with corrected_output set to the right output, or use verdict accept.",
        );
      }
      const body = { verdict: "correct", correctedOutput: args["corrected_output"], reviewer };
      return { item: bodyOf(await api.decideReview(String(args["item_id"]), body))["item"] };
    },
  });
}
