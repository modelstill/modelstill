import {
  context,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Span,
  type SpanOptions,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

export { SpanKind, SpanStatusCode };
export type { Attributes, Context, Span };

const TRACER_NAME = "@modelstill/telemetry";
const DEFAULT_ENDPOINT = "https://api.axiom.co";
const DEFAULT_DATASET = "modelstill-traces";
const DEFAULT_RATIO = 0.1;

export interface TelemetryOptions {
  serviceName: string;
  serviceVersion?: string;
  spanProcessor?: SpanProcessor;
  env?: Record<string, string | undefined>;
  warn?: (message: string) => void;
}

export interface Telemetry {
  enabled: boolean;
  exporter?: { url: string; dataset: string };
  shutdown(): Promise<void>;
}

function sampleRatio(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (raw === undefined || raw === "" || Number.isNaN(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

export function startTelemetry(options: TelemetryOptions): Telemetry {
  const env = options.env ?? process.env;
  const warn = options.warn ?? ((m) => process.stderr.write(`[telemetry] ${m}\n`));

  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());

  const unregister = () => {
    context.disable();
    propagation.disable();
    trace.disable();
  };

  let processor = options.spanProcessor;
  let exporter: Telemetry["exporter"];
  if (!processor) {
    if (env.OTEL_ENABLED !== "true") return { enabled: false, shutdown: async () => unregister() };
    const token = env.AXIOM_OTEL_TOKEN ?? env.AXIOM_TOKEN;
    if (!token) {
      warn("OTEL_ENABLED=true but neither AXIOM_OTEL_TOKEN nor AXIOM_TOKEN is set; traces stay off");
      return { enabled: false, shutdown: async () => unregister() };
    }
    const endpoint = (env.AXIOM_OTEL_ENDPOINT ?? DEFAULT_ENDPOINT).replace(/\/$/, "");
    const dataset = env.AXIOM_TRACES_DATASET ?? DEFAULT_DATASET;
    exporter = { url: `${endpoint}/v1/traces`, dataset };
    processor = new BatchSpanProcessor(
      new OTLPTraceExporter({
        url: exporter.url,
        headers: { Authorization: `Bearer ${token}`, "X-Axiom-Dataset": dataset },
      }),
    );
  }

  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: options.serviceName,
      [ATTR_SERVICE_VERSION]: options.serviceVersion ?? env.SERVICE_VERSION ?? "unknown",
      "deployment.environment": env.DEPLOYMENT_ENV ?? "cluster",
    }),
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(
        sampleRatio(env.OTEL_TRACES_SAMPLE_RATIO, options.spanProcessor ? 1 : DEFAULT_RATIO),
      ),
    }),
    spanProcessors: [processor],
  });
  trace.setGlobalTracerProvider(provider);
  if (exporter) warn(`traces on -> ${exporter.dataset} (service=${options.serviceName})`);

  return {
    enabled: true,
    exporter,
    shutdown: async () => {
      await provider.shutdown().catch(() => undefined);
      unregister();
    },
  };
}

export interface WithSpanOptions {
  kind?: SpanKind;
  attributes?: Attributes;
}

export async function withSpan<T>(
  name: string,
  options: WithSpanOptions,
  fn: (span: Span) => Promise<T> | T,
): Promise<T> {
  const spanOptions: SpanOptions = { kind: options.kind, attributes: options.attributes };
  return trace.getTracer(TRACER_NAME).startActiveSpan(name, spanOptions, async (span) => {
    try {
      return await fn(span);
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      if (err instanceof Error) span.recordException(err);
      throw err;
    } finally {
      span.end();
    }
  });
}

export function inject(): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier;
}

export function extract(carrier: Record<string, string | undefined>): Context {
  return propagation.extract(ROOT_CONTEXT, carrier);
}

export function runInContext<T>(ctx: Context, fn: () => T): T {
  return context.with(ctx, fn);
}

export interface TraceIds {
  trace_id: string;
  span_id: string;
}

export function currentTraceIds(): TraceIds | undefined {
  const span = trace.getSpan(context.active());
  if (!span) return undefined;
  const ctx = span.spanContext();
  if (!trace.isSpanContextValid(ctx)) return undefined;
  return { trace_id: ctx.traceId, span_id: ctx.spanId };
}
