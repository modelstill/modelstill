import { describe, expect, test } from "bun:test";
import * as z from "zod/v4";
import { closestKey, refuseUnknownArgs } from "../src/tools/strict-args.ts";

const shape = { task: z.string(), limit: z.number().optional() };

describe("strict args", () => {
  test("a call with only declared args is let through", () => {
    expect(refuseUnknownArgs("get_review_queue", { task: "t", limit: undefined }, shape)).toBeNull();
  });

  test("an unknown arg is refused with the declared key it most likely meant", () => {
    const refused = refuseUnknownArgs("get_review_queue", { task: "t", limt: 5 }, shape);
    expect(refused?.isError).toBe(true);
    const body = JSON.parse(refused!.content[0]!.text);
    expect(body.error).toBe("unknown_arguments");
    expect(body.message).toContain('"limt" is not a get_review_queue argument. Did you mean "limit"?');
    expect(body.unknown_arguments).toEqual(["limt"]);
    expect(body.retryable).toBe(false);
    expect(body.next_step).toContain("without that argument");
  });

  test("closestKey matches case and separator differences and contained keys", () => {
    expect(closestKey("Task", ["task", "limit"])).toBe("task");
    expect(closestKey("task_slug", ["task", "limit"])).toBe("task");
    expect(closestKey("zzzzzz", ["task", "limit"])).toBeUndefined();
  });
});
