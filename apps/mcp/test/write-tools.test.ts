import { describe, expect, test } from "bun:test";
import * as fx from "./fixtures.ts";
import { callTool, connect } from "./harness.ts";
import { stubRoutes } from "./stub.ts";

const SLUG = fx.task.slug;
const DEPLOYMENT_PATH = `/v1/tasks/${SLUG}/deployment`;

describe("decide_review_item", () => {
  test("accepts an item", async () => {
    const accepted = { ...fx.reviewItem, reviewState: "accepted" };
    const stub = stubRoutes({ "POST /v1/review-queue/item-1/decision": { status: 200, body: { item: accepted } } });
    const answer = await callTool(await connect(stub), "decide_review_item", { item_id: "item-1", verdict: "accept", reviewer: "ana" });
    expect(answer.structured).toEqual({ item: accepted });
    expect(stub.requests[0]?.body).toEqual({ verdict: "accept", reviewer: "ana" });
  });

  test("a correction sends the corrected output and a default reviewer", async () => {
    const corrected = { ...fx.reviewItem, reviewState: "corrected" };
    const stub = stubRoutes({ "POST /v1/review-queue/item-1/decision": { status: 200, body: { item: corrected } } });
    const answer = await callTool(await connect(stub), "decide_review_item", {
      item_id: "item-1",
      verdict: "correct",
      corrected_output: { label: "c" },
    });
    expect(answer.isError).toBe(false);
    expect(stub.requests[0]?.body).toEqual({ verdict: "correct", correctedOutput: { label: "c" }, reviewer: "modelstill-mcp" });
  });

  test("a correction without corrected_output is refused before any API call", async () => {
    const stub = stubRoutes({});
    const answer = await callTool(await connect(stub), "decide_review_item", { item_id: "item-1", verdict: "correct" });
    expect(answer.isError).toBe(true);
    expect(answer.body.error).toBe("missing_corrected_output");
    expect(stub.requests).toHaveLength(0);
  });

  test("a write answered 429 is not retried", async () => {
    const stub = stubRoutes({ "POST /v1/review-queue/item-1/decision": { status: 429, body: { error: "rate_limited" } } });
    const answer = await callTool(await connect(stub), "decide_review_item", { item_id: "item-1", verdict: "accept" });
    expect(stub.requests).toHaveLength(1);
    expect(answer.body.retryable).toBe(true);
  });

  test("an unknown item points at get_review_queue", async () => {
    const answer = await callTool(await connect(stubRoutes({})), "decide_review_item", { item_id: "x", verdict: "accept" });
    expect(String(answer.body.next_step)).toContain("get_review_queue");
  });
});

describe("set_deployment_mode", () => {
  test("changes only the mode and keeps the rest of the deployment", async () => {
    const stub = stubRoutes({
      [`GET ${DEPLOYMENT_PATH}`]: { status: 200, body: { deployment: fx.deployment } },
      [`PUT ${DEPLOYMENT_PATH}`]: (request) => ({ status: 200, body: { deployment: { ...(request.body as object), activeFrom: "now" } } }),
    });
    const answer = await callTool(await connect(stub), "set_deployment_mode", { task: SLUG, mode: "serve" });
    expect(stub.requests[1]?.body).toEqual({
      mode: "serve",
      studentModel: "student-v3",
      threshold: 0.7,
      targetError: 0.05,
      shadowSample: 0.1,
      activeFrom: null,
    });
    expect(answer.structured).toMatchObject({ previous_mode: "shadow", deployment: { mode: "serve" } });
    expect(String(answer.structured?.["rollback"])).toContain('mode "off"');
  });

  test("overrides what the call names", async () => {
    const stub = stubRoutes({
      [`GET ${DEPLOYMENT_PATH}`]: { status: 200, body: { deployment: fx.deployment } },
      [`PUT ${DEPLOYMENT_PATH}`]: (request) => ({ status: 200, body: { deployment: { ...(request.body as object), activeFrom: "now" } } }),
    });
    await callTool(await connect(stub), "set_deployment_mode", {
      task: SLUG,
      mode: "shadow",
      student_model: "student-v4",
      threshold: 0.6,
      target_error: 0.02,
      shadow_sample: 0.5,
    });
    expect(stub.requests[1]?.body).toEqual({
      mode: "shadow",
      studentModel: "student-v4",
      threshold: 0.6,
      targetError: 0.02,
      shadowSample: 0.5,
      activeFrom: null,
    });
  });

  test("rollback to off works with no deployment yet, using a default target error", async () => {
    const stub = stubRoutes({
      [`GET ${DEPLOYMENT_PATH}`]: { status: 200, body: { deployment: null } },
      [`PUT ${DEPLOYMENT_PATH}`]: (request) => ({ status: 200, body: { deployment: { ...(request.body as object), activeFrom: "now" } } }),
    });
    const answer = await callTool(await connect(stub), "set_deployment_mode", { task: SLUG, mode: "off" });
    expect(answer.isError).toBe(false);
    expect(answer.structured?.["previous_mode"]).toBeNull();
    expect(stub.requests[1]?.body).toMatchObject({ mode: "off", studentModel: null, targetError: 0.05 });
  });

  test("serving with no student model is refused without a write", async () => {
    const stub = stubRoutes({ [`GET ${DEPLOYMENT_PATH}`]: { status: 200, body: { deployment: null } } });
    const answer = await callTool(await connect(stub), "set_deployment_mode", { task: SLUG, mode: "serve" });
    expect(answer.isError).toBe(true);
    expect(answer.body.error).toBe("missing_student_model");
    expect(stub.requests.map((r) => r.method)).toEqual(["GET"]);
  });

  test("a first shadow deployment needs a target error", async () => {
    const stub = stubRoutes({ [`GET ${DEPLOYMENT_PATH}`]: { status: 200, body: { deployment: null } } });
    const answer = await callTool(await connect(stub), "set_deployment_mode", { task: SLUG, mode: "shadow", student_model: "s" });
    expect(answer.body.error).toBe("missing_target_error");
    expect(stub.requests.map((r) => r.method)).toEqual(["GET"]);
  });

  test("a mode outside off, shadow and serve is refused by the schema", async () => {
    const stub = stubRoutes({});
    const client = await connect(stub);
    const result = await client.callTool({ name: "set_deployment_mode", arguments: { task: SLUG, mode: "on" } });
    expect(result.isError).toBe(true);
    expect(stub.requests).toHaveLength(0);
  });

  test("a failed write is reported and never retried", async () => {
    const stub = stubRoutes({
      [`GET ${DEPLOYMENT_PATH}`]: { status: 200, body: { deployment: fx.deployment } },
      [`PUT ${DEPLOYMENT_PATH}`]: { status: 503, body: { error: "unavailable" } },
    });
    const answer = await callTool(await connect(stub), "set_deployment_mode", { task: SLUG, mode: "off" });
    expect(answer.isError).toBe(true);
    expect(stub.requests.filter((r) => r.method === "PUT")).toHaveLength(1);
  });
});
