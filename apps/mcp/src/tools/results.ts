import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { type Issue, UpstreamError } from "../upstream.ts";

export class ToolRefusal extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly nextStep: string,
  ) {
    super(message);
    this.name = "ToolRefusal";
  }
}

export interface NextSteps {
  notFound?: string;
  invalid?: string;
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export function asText(data: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    isError,
  };
}

export function asStructured(data: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

function describeIssues(issues: Issue[]): string {
  return issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ");
}

function upstreamMessage(error: UpstreamError): string {
  if (error.code === "upstream_unreachable") return "The ModelStill API could not be reached.";
  if (error.status === 404) return "The ModelStill API has no such record.";
  if (error.status === 401 || error.status === 403) return "The ModelStill API refused the credentials.";
  if (error.status === 429) return "The ModelStill API is rate limiting this caller.";
  if (error.status === 400 && error.issues?.length) return `The ModelStill API refused the request: ${describeIssues(error.issues)}.`;
  if (error.status === 400) return `The ModelStill API refused the request (${error.code}).`;
  return `The ModelStill API answered ${error.status}.`;
}

function upstreamNextStep(error: UpstreamError, steps: NextSteps): string {
  if (error.status === 404) return steps.notFound ?? "Check the identifier. list_tasks shows every task slug.";
  if (error.status === 401 || error.status === 403)
    return "Reconnect the MCP server, or send a valid ModelStill API key (ms_live_) as an Authorization: Bearer header.";
  if (error.status === 429)
    return `Wait ${error.retryAfter ?? 1} s, then send the call again. Make the remaining calls one at a time.`;
  if (error.status === 400) return steps.invalid ?? "Fix the arguments named in message and send the call again.";
  return "Retry in a few seconds. If it keeps failing, the ModelStill API is down.";
}

function upstreamResult(error: UpstreamError, steps: NextSteps) {
  return asText(
    {
      error: error.code,
      message: upstreamMessage(error),
      next_step: upstreamNextStep(error, steps),
      retryable: RETRYABLE_STATUSES.has(error.status),
      ...(error.retryAfter === undefined ? {} : { retry_after: error.retryAfter }),
      ...(error.issues ? { issues: error.issues } : {}),
    },
    true,
  );
}

export function errorResult(error: unknown, steps: NextSteps = {}) {
  if (error instanceof UpstreamError) return upstreamResult(error, steps);
  if (error instanceof ToolRefusal) {
    return asText({ error: error.code, message: error.message, next_step: error.nextStep, retryable: false }, true);
  }
  return asText(
    {
      error: "internal_error",
      message: error instanceof Error ? error.message : "The tool failed.",
      next_step: "Do not repeat the call unchanged. Report the failure to the user.",
      retryable: false,
    },
    true,
  );
}

export function titled<H extends ToolAnnotations>(title: string, hints: H): { title: string; annotations: H & { title: string } } {
  return { title, annotations: { ...hints, title } };
}
