import { afterEach, expect, test } from "bun:test";
import pino from "pino";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { startTelemetry, withSpan, type Telemetry } from "@modelstill/telemetry";
import { traceMixin } from "../src/trace-mixin.ts";

let telemetry: Telemetry | undefined;

afterEach(async () => {
  await telemetry?.shutdown();
  telemetry = undefined;
});

function capturingLogger() {
  const lines: Record<string, unknown>[] = [];
  const stream = { write: (chunk: string) => void lines.push(JSON.parse(chunk)) };
  return { lines, log: pino({ mixin: traceMixin }, stream) };
}

test("outside any span the mixin adds nothing", () => {
  expect(traceMixin()).toEqual({});
  const { lines, log } = capturingLogger();
  log.info({ request_id: "r1" }, "api_request");
  expect(lines[0]).not.toHaveProperty("trace_id");
  expect(lines[0]).toMatchObject({ request_id: "r1", msg: "api_request" });
});

test("inside a span every line carries the span's trace_id, and nothing else new, beside the call site's fields", async () => {
  telemetry = startTelemetry({
    serviceName: "logger-test",
    spanProcessor: new SimpleSpanProcessor(new InMemorySpanExporter()),
  });
  const { lines, log } = capturingLogger();
  let expected: { traceId: string; spanId: string } | undefined;
  await withSpan("HTTP GET", {}, async (span) => {
    expected = span.spanContext();
    log.info({ request_id: "r1", status: 200 }, "api_request");
  });
  expect(lines[0]).toMatchObject({
    request_id: "r1",
    status: 200,
    msg: "api_request",
    trace_id: expected?.traceId,
  });
  expect(lines[0].trace_id).toMatch(/^[0-9a-f]{32}$/);
  expect(lines[0]).not.toHaveProperty("span_id");
});

test("a caller's own trace_id wins over the mixin's", async () => {
  telemetry = startTelemetry({
    serviceName: "logger-test",
    spanProcessor: new SimpleSpanProcessor(new InMemorySpanExporter()),
  });
  const { lines, log } = capturingLogger();
  await withSpan("jobs.search", {}, async () => {
    log.info({ trace_id: "legacy-request-id" }, "job-search query ok");
  });
  expect(lines[0].trace_id).toBe("legacy-request-id");
});
