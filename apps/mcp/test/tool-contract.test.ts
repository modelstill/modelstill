import { describe, expect, test } from "bun:test";
import { connect } from "./harness.ts";
import { stubFetch } from "./stub.ts";

const READ_TOOLS = [
  "list_tasks",
  "get_task",
  "list_eval_runs",
  "compare_runs",
  "list_gates",
  "get_review_queue",
  "get_deployment",
  "get_traffic",
  "list_canaries",
  "list_alerts",
  "list_train_runs",
  "get_train_run",
];

const WRITE_TOOLS = ["decide_review_item", "set_deployment_mode"];

describe("tool contract", async () => {
  const stub = stubFetch(() => ({ status: 200, body: {} }));
  const client = await connect(stub);
  const { tools } = await client.listTools();
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  test("exposes exactly the read and write tools", () => {
    expect([...byName.keys()].sort()).toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort());
  });

  test("every tool has a title in both places, a description, and an output schema", () => {
    for (const tool of tools) {
      expect(tool.title).toBeTruthy();
      expect(tool.annotations?.title).toBe(tool.title!);
      expect(tool.description!.length).toBeGreaterThan(80);
      expect(tool.outputSchema?.type).toBe("object");
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  test("every tool states all four hints", () => {
    for (const tool of tools) {
      expect(typeof tool.annotations?.readOnlyHint).toBe("boolean");
      expect(typeof tool.annotations?.destructiveHint).toBe("boolean");
      expect(typeof tool.annotations?.idempotentHint).toBe("boolean");
      expect(typeof tool.annotations?.openWorldHint).toBe("boolean");
    }
  });

  test("read tools are read-only, idempotent and not destructive", () => {
    for (const name of READ_TOOLS) {
      const hints = byName.get(name)!.annotations!;
      expect(hints.readOnlyHint).toBe(true);
      expect(hints.destructiveHint).toBe(false);
      expect(hints.idempotentHint).toBe(true);
    }
  });

  test("write tools are not read-only and are marked destructive", () => {
    for (const name of WRITE_TOOLS) {
      const hints = byName.get(name)!.annotations!;
      expect(hints.readOnlyHint).toBe(false);
      expect(hints.destructiveHint).toBe(true);
    }
  });

  test("set_deployment_mode says rollback is mode off", () => {
    expect(byName.get("set_deployment_mode")!.description).toContain('mode "off"');
  });

  test("listing tools makes no API call", () => {
    expect(stub.requests).toHaveLength(0);
  });
});
