import type { ReviewCandidate } from "./api";
import type { NewCase, ServedRequest } from "./cases-api";

export type DeferredFilter = "all" | "deferred" | "student";

export type RequestFilters = { task: string | null; deferred: DeferredFilter; from: string | null; to: string | null };

const DAY_MS = 24 * 3600 * 1000;

function dayStart(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

export function requestSearch(filters: RequestFilters, cursor: string | null, limit: number): string {
  const params = new URLSearchParams();
  if (filters.task) params.set("task", filters.task);
  if (filters.deferred !== "all") params.set("deferred", filters.deferred === "deferred" ? "true" : "false");
  if (filters.from) params.set("from", new Date(dayStart(filters.from)).toISOString());
  if (filters.to) params.set("to", new Date(dayStart(filters.to) + DAY_MS).toISOString());
  if (cursor) params.set("cursor", cursor);
  params.set("limit", String(limit));
  return params.toString();
}

export function dayRange(now: Date, days: number): { from: string; to: string } {
  const to = now.toISOString().slice(0, 10);
  const from = new Date(dayStart(to) - (days - 1) * DAY_MS).toISOString().slice(0, 10);
  return { from, to };
}

export function formatLatency(ms: number | null): string {
  if (ms === null) return "n/a";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

export function formatCost(usd: number | null): string {
  if (usd === null) return "n/a";
  return usd >= 0.01 ? `$${usd.toFixed(2)}` : `$${Number(usd.toPrecision(3))}`;
}

export function formatRequestTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

const REASONS: Record<string, (request: ServedRequest) => string> = {
  low_confidence: (request) =>
    `the student's confidence ${request.confidence === null ? "n/a" : request.confidence.toFixed(2)} was below the threshold`,
  model_mismatch: () => "a model other than the deployed student answered",
  no_threshold: () => "the deployment has no confidence threshold yet",
  no_confidence: () => "the student returned no confidence",
  student_error: () => "the student call failed",
};

export function deferralReason(request: ServedRequest): string {
  if (request.deferred) return `Deferred to the cloud model: ${REASONS[request.reason ?? ""]?.(request) ?? request.reason ?? "no reason logged"}.`;
  if (request.servedFrom === "student") return "Not deferred: the student answered.";
  return `Not deferred: the deployment runs in ${request.mode} mode, so the cloud model answered.`;
}

const HASH_NOTE ="the gateway logs only a hash of the request";

export function reviewCandidateFromRequest(request: ServedRequest): ReviewCandidate {
  const outputs: Record<string, unknown> = {};
  if (request.studentOutput !== null) outputs[`student (${request.studentModel ?? "unknown"})`] = request.studentOutput;
  if (request.cloudOutput !== null) outputs[`cloud (${request.cloudModel ?? "unknown"})`] = request.cloudOutput;
  return { inputHash: request.requestHash, input: { requestHash: request.requestHash, note: HASH_NOTE }, outputs };
}

export function caseFromRequest(request: ServedRequest): NewCase {
  return {
    input: { requestHash: request.requestHash },
    expected: request.cloudOutput ?? request.studentOutput,
    metadata: {
      source: "production",
      requestHash: request.requestHash,
      ts: request.ts,
      task: request.task,
      deferred: request.deferred,
      reason: request.reason,
      studentOutput: request.studentOutput,
      answeredBy: request.answeredBy,
    },
  };
}
