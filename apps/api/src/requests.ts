export type ServedRequest = {
  ts: string;
  task: string;
  deploymentId: string;
  requestHash: string;
  mode: string;
  servedFrom: string;
  deferred: boolean;
  reason: string | null;
  confidence: number | null;
  studentModel: string | null;
  modelMatch: boolean | null;
  studentOutput: string | null;
  cloudModel: string | null;
  cloudOutput: string | null;
  studentMs: number | null;
  cloudMs: number | null;
  studentCostUsd: number | null;
  cloudCostUsd: number | null;
};

export type RequestCursor = { ts: number; requestHash: string };

export type RequestQuery = {
  task: string | null;
  deferred: boolean | null;
  from: string;
  to: string;
  cursor: RequestCursor | null;
  limit: number;
};

export type RequestLog = { requests: (query: RequestQuery) => Promise<ServedRequest[]> };

export const noRequests: RequestLog = { requests: async () => [] };

export type DescribedRequest = ServedRequest & {
  id: string;
  answeredBy: string | null;
  latencyMs: number | null;
  costUsd: number | null;
};

function sumKnown(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0);
}

export function describeRequest(request: ServedRequest): DescribedRequest {
  const fromStudent = request.servedFrom === "student";
  return {
    ...request,
    id: `${Date.parse(request.ts)}:${request.requestHash}`,
    answeredBy: fromStudent ? request.studentModel : request.cloudModel,
    latencyMs: fromStudent ? request.studentMs : request.deferred ? sumKnown([request.studentMs, request.cloudMs]) : request.cloudMs,
    costUsd: sumKnown([request.studentCostUsd, request.cloudCostUsd]),
  };
}

export function encodeCursor(request: ServedRequest): string {
  return Buffer.from(JSON.stringify({ ts: Date.parse(request.ts), h: request.requestHash })).toString("base64url");
}

export function decodeCursor(value: string): RequestCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { ts?: unknown; h?: unknown };
    if (typeof parsed.ts !== "number" || !Number.isSafeInteger(parsed.ts) || typeof parsed.h !== "string") return null;
    return { ts: parsed.ts, requestHash: parsed.h };
  } catch {
    return null;
  }
}
