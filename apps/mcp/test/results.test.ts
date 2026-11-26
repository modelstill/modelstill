import { describe, expect, test } from "bun:test";
import { asStructured, errorResult, ToolRefusal } from "../src/tools/results.ts";
import { UpstreamError } from "../src/upstream.ts";

function bodyOf(result: { content: { text: string }[] }) {
  return JSON.parse(result.content[0]!.text);
}

describe("results", () => {
  test("a success carries the payload as text and as structured content", () => {
    const result = asStructured({ tasks: [] });
    expect(result.content).toEqual([{ type: "text", text: '{"tasks":[]}' }]);
    expect(result.structuredContent).toEqual({ tasks: [] });
  });

  test("a 404 is not retryable and says what to do next", () => {
    const result = errorResult(new UpstreamError(404, "not_found"), { notFound: "Call list_tasks." });
    expect(result.isError).toBe(true);
    expect(bodyOf(result)).toEqual({
      error: "not_found",
      message: "The ModelStill API has no such record.",
      next_step: "Call list_tasks.",
      retryable: false,
    });
  });

  test("a 429 is retryable and passes retry_after on", () => {
    const body = bodyOf(errorResult(new UpstreamError(429, "rate_limited", undefined, 3)));
    expect(body.retryable).toBe(true);
    expect(body.retry_after).toBe(3);
    expect(body.next_step).toContain("3 s");
  });

  test("a 400 carries the API's issues", () => {
    const issues = [{ message: "too big", path: ["limit"] }];
    const body = bodyOf(errorResult(new UpstreamError(400, "invalid_request", issues)));
    expect(body.retryable).toBe(false);
    expect(body.issues).toEqual(issues);
    expect(body.message).toContain("limit: too big");
  });

  test("a 401 tells the caller to reconnect", () => {
    const body = bodyOf(errorResult(new UpstreamError(401, "unauthorized")));
    expect(body.retryable).toBe(false);
    expect(body.next_step).toContain("API key");
  });

  test("a 5xx and an unreachable API are retryable", () => {
    expect(bodyOf(errorResult(new UpstreamError(503, "upstream_503"))).retryable).toBe(true);
    expect(bodyOf(errorResult(new UpstreamError(502, "upstream_unreachable"))).retryable).toBe(true);
  });

  test("a refusal keeps its own error, message and next step", () => {
    const body = bodyOf(errorResult(new ToolRefusal("missing_student_model", "No student.", "Pass student_model.")));
    expect(body).toEqual({
      error: "missing_student_model",
      message: "No student.",
      next_step: "Pass student_model.",
      retryable: false,
    });
  });

  test("anything else is an internal error", () => {
    const body = bodyOf(errorResult(new Error("boom")));
    expect(body.error).toBe("internal_error");
    expect(body.retryable).toBe(false);
  });
});
