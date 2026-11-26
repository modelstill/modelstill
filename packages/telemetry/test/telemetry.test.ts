import { afterEach, describe, expect, test } from "bun:test";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import {
  currentTraceIds,
  extract,
  inject,
  runInContext,
  startTelemetry,
  type Telemetry,
  withSpan,
} from "../src/index.ts";

let running: Telemetry | undefined;

function start(env: Record<string, string> = {}) {
  const exporter = new InMemorySpanExporter();
  running = startTelemetry({
    serviceName: "modelstill-test",
    spanProcessor: new SimpleSpanProcessor(exporter),
    env,
  });
  return { exporter, telemetry: running };
}

afterEach(async () => {
  await running?.shutdown();
  running = undefined;
});

describe("startTelemetry with a span processor", () => {
  test("records a span with the service name, kind, attributes and the function's result", async () => {
    const { exporter } = start();
    const result = await withSpan(
      "jobs.search",
      { kind: SpanKind.CONSUMER, attributes: { "modelstill.plan": "pro" } },
      async (span) => {
        span.setAttribute("modelstill.returned", 3);
        return "ok";
      },
    );
    expect(result).toBe("ok");
    const [span] = exporter.getFinishedSpans();
    expect(span.name).toBe("jobs.search");
    expect(span.kind).toBe(SpanKind.CONSUMER);
    expect(span.attributes).toMatchObject({ "modelstill.plan": "pro", "modelstill.returned": 3 });
    expect(span.resource.attributes["service.name"]).toBe("modelstill-test");
    expect(span.status.code).toBe(SpanStatusCode.UNSET);
  });

  test("a throwing function marks the span as an error, records the exception and rethrows", async () => {
    const { exporter } = start();
    await expect(
      withSpan("jobs.relay", {}, async () => {
        throw new Error("rabbit is down");
      }),
    ).rejects.toThrow("rabbit is down");
    const [span] = exporter.getFinishedSpans();
    expect(span.status).toEqual({ code: SpanStatusCode.ERROR, message: "rabbit is down" });
    expect(span.events.map((e) => e.name)).toContain("exception");
  });

  test("inject() inside a span yields a traceparent carrying that span's trace id", async () => {
    start();
    await withSpan("HTTP GET", {}, async (span) => {
      const carrier = inject();
      const { traceId, spanId } = span.spanContext();
      expect(carrier.traceparent).toBe(`00-${traceId}-${spanId}-01`);
      expect(currentTraceIds()).toEqual({ trace_id: traceId, span_id: spanId });
    });
  });

  test("extract() + runInContext() makes the next span a child in the same trace, across a JSON hop", async () => {
    const { exporter } = start();
    let carrier: Record<string, string> = {};
    await withSpan("jobs.request", { kind: SpanKind.CLIENT }, async () => {
      carrier = inject();
    });
    const hop = JSON.parse(JSON.stringify({ traceparent: carrier.traceparent })) as {
      traceparent?: string;
    };
    await runInContext(extract(hop), () => withSpan("jobs.relay", {}, async () => undefined));
    const spans = exporter.getFinishedSpans();
    const parent = spans.find((s) => s.name === "jobs.request");
    const child = spans.find((s) => s.name === "jobs.relay");
    expect(child?.spanContext().traceId).toBe(parent?.spanContext().traceId);
    expect(child?.parentSpanContext?.spanId).toBe(parent?.spanContext().spanId);
  });

  test("extract() of an empty or malformed carrier starts a fresh root", async () => {
    const { exporter } = start();
    await runInContext(extract({}), () => withSpan("a", {}, async () => undefined));
    await runInContext(extract({ traceparent: "garbage" }), () =>
      withSpan("b", {}, async () => undefined),
    );
    for (const span of exporter.getFinishedSpans()) expect(span.parentSpanContext).toBeUndefined();
  });

  test("the context is per async chain: two concurrent spans do not see each other", async () => {
    start();
    const seen: string[] = [];
    await Promise.all([
      withSpan("one", {}, async () => {
        await new Promise((r) => setTimeout(r, 5));
        seen.push(currentTraceIds()?.trace_id ?? "");
      }),
      withSpan("two", {}, async () => {
        seen.push(currentTraceIds()?.trace_id ?? "");
      }),
    ]);
    expect(new Set(seen).size).toBe(2);
  });

  test("outside any span there are no trace ids and nothing to inject", () => {
    start();
    expect(currentTraceIds()).toBeUndefined();
    expect(inject()).toEqual({});
  });
});

describe("sampling", () => {
  test("a ratio of 0 exports nothing but still hands the trace id to logs and to the next hop", async () => {
    const { exporter } = start({ OTEL_TRACES_SAMPLE_RATIO: "0" });
    let ids: ReturnType<typeof currentTraceIds>;
    let carrier: Record<string, string> = {};
    await withSpan("HTTP GET", {}, async () => {
      ids = currentTraceIds();
      carrier = inject();
    });
    expect(exporter.getFinishedSpans()).toHaveLength(0);
    expect(ids?.trace_id).toMatch(/^[0-9a-f]{32}$/);
    expect(carrier.traceparent).toEndWith("-00");
  });

  test("a child follows its parent's decision, so a sampled request is traced on every hop", async () => {
    const { exporter } = start({ OTEL_TRACES_SAMPLE_RATIO: "0" });
    const sampledParent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    await runInContext(extract({ traceparent: sampledParent }), () =>
      withSpan("jobs.search", {}, async () => undefined),
    );
    const [span] = exporter.getFinishedSpans();
    expect(span.spanContext().traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
  });
});

describe("startTelemetry from the environment", () => {
  test("is off unless OTEL_ENABLED=true and a token exist; spans then cost nothing and inject nothing", async () => {
    running = startTelemetry({ serviceName: "modelstill-test", env: {} });
    expect(running.enabled).toBe(false);
    const value = await withSpan("HTTP GET", {}, async () => 42);
    expect(value).toBe(42);
    expect(inject()).toEqual({});
    expect(currentTraceIds()).toBeUndefined();
  });

  test("OTEL_ENABLED=true without a token stays off and says so", () => {
    const warnings: string[] = [];
    running = startTelemetry({
      serviceName: "modelstill-test",
      env: { OTEL_ENABLED: "true" },
      warn: (m) => warnings.push(m),
    });
    expect(running.enabled).toBe(false);
    expect(warnings.join("\n")).toContain("AXIOM_OTEL_TOKEN");
  });

  test("with a token it is on, and the exporter targets the Axiom dataset", () => {
    running = startTelemetry({
      serviceName: "modelstill-test",
      env: { OTEL_ENABLED: "true", AXIOM_TOKEN: "xaat-test", AXIOM_TRACES_DATASET: "modelstill-traces" },
    });
    expect(running.enabled).toBe(true);
    expect(running.exporter).toEqual({
      url: "https://api.axiom.co/v1/traces",
      dataset: "modelstill-traces",
    });
  });
});
