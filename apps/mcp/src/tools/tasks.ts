import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { Api } from "../upstream.ts";
import { READ_HINTS, registerApiTool } from "./register.ts";
import { bodyOf, listOf, TASK_NOT_FOUND } from "./json.ts";
import { TaskSummary, TaskVersion, taskArg } from "./schemas.ts";

export function registerTaskTools(server: McpServer, api: Api): void {
  registerApiTool(server, {
    name: "list_tasks",
    title: "List tasks",
    description:
      "Lists every ModelStill task: its slug, current version and snapshot hash, serving mode (off, shadow or serve), the share of recent calls deferred to the cloud model, and whether its last gate passed. Start here to find the slug every other tool takes.",
    input: {},
    output: { tasks: z.array(TaskSummary) },
    hints: READ_HINTS,
    handler: async () => ({ tasks: listOf(await api.listTasks(), "tasks") }),
  });

  registerApiTool(server, {
    name: "get_task",
    title: "Get task",
    description:
      "Returns one task's summary (version, snapshot hash, serving mode, deferral share, last gate result) together with every registered version of it, newest first, each with its git SHA and creation time. Use it to see what changed between versions or to confirm a slug.",
    input: { task: taskArg },
    output: { task: TaskSummary, versions: z.array(TaskVersion) },
    hints: READ_HINTS,
    steps: { notFound: TASK_NOT_FOUND },
    handler: async (args) => {
      const slug = String(args["task"]);
      const [task, versions] = await Promise.all([api.getTask(slug), api.listVersions(slug)]);
      return { task: bodyOf(task)["task"], versions: listOf(versions, "versions") };
    },
  });
}
