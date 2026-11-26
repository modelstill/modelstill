import { context, trace } from "@opentelemetry/api";

export function traceMixin(): Record<string, string> {
  const span = trace.getSpan(context.active());
  if (!span) return {};
  const ctx = span.spanContext();
  if (!trace.isSpanContextValid(ctx)) return {};
  return { trace_id: ctx.traceId };
}
