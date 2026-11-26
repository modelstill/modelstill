import { describe, expect, test } from "bun:test";
import type { ServedRequest } from "../src/lib/cases-api";
import { caseFromRequest, dayRange, deferralReason, formatCost, formatLatency, formatRequestTime, reviewCandidateFromRequest, requestSearch } from "../src/lib/requests";

const deferred: ServedRequest = {
  id: "1763892000000:aaaa000000000002",
  ts: "2026-11-23T10:00:00.000Z",
  task: "capitals",
  deploymentId: "dep-1",
  requestHash: "aaaa000000000002",
  mode: "serve",
  servedFrom: "cloud",
  deferred: true,
  reason: "low_confidence",
  confidence: 0.41,
  answeredBy: "cloud-large",
  studentModel: "capitals-v2",
  modelMatch: true,
  studentOutput: "Lyon",
  cloudModel: "cloud-large",
  cloudOutput: "Paris",
  latencyMs: 780,
  studentMs: 80,
  cloudMs: 700,
  costUsd: 0.00112,
  studentCostUsd: 0.00002,
  cloudCostUsd: 0.0011,
};

describe("request filters", () => {
  test("only set filters go into the query string", () => {
    expect(requestSearch({ task: "capitals", deferred: "deferred", from: "2026-11-20", to: "2026-11-22" }, null, 50)).toBe(
      "task=capitals&deferred=true&from=2026-11-20T00%3A00%3A00.000Z&to=2026-11-23T00%3A00%3A00.000Z&limit=50",
    );
    expect(requestSearch({ task: null, deferred: "all", from: null, to: null }, "abc", 25)).toBe("cursor=abc&limit=25");
    expect(requestSearch({ task: null, deferred: "student", from: null, to: null }, null, 50)).toBe("deferred=false&limit=50");
  });

  test("the default range is the last seven days, by calendar day", () => {
    expect(dayRange(new Date("2026-11-24T15:30:00Z"), 7)).toEqual({ from: "2026-11-18", to: "2026-11-24" });
  });
});

describe("request formatting", () => {
  test("latency and cost read n/a when not logged", () => {
    expect(formatLatency(780.4)).toBe("780 ms");
    expect(formatLatency(1530)).toBe("1.53 s");
    expect(formatLatency(null)).toBe("n/a");
    expect(formatCost(0.00112)).toBe("$0.00112");
    expect(formatCost(1.5)).toBe("$1.50");
    expect(formatCost(null)).toBe("n/a");
  });
});

describe("request wording", () => {
  test("time to the second in UTC", () => {
    expect(formatRequestTime("2026-11-23T10:00:05.123Z")).toBe("2026-11-23 10:00:05 UTC");
  });

  test("each deferral reason the router records reads as a sentence", () => {
    expect(deferralReason(deferred)).toBe("Deferred to the cloud model: the student's confidence 0.41 was below the threshold.");
    expect(deferralReason({ ...deferred, reason: "model_mismatch" })).toBe("Deferred to the cloud model: a model other than the deployed student answered.");
    expect(deferralReason({ ...deferred, reason: "no_threshold" })).toBe("Deferred to the cloud model: the deployment has no confidence threshold yet.");
    expect(deferralReason({ ...deferred, reason: "no_confidence" })).toBe("Deferred to the cloud model: the student returned no confidence.");
    expect(deferralReason({ ...deferred, reason: "student_error" })).toBe("Deferred to the cloud model: the student call failed.");
    expect(deferralReason({ ...deferred, reason: "new_reason" })).toBe("Deferred to the cloud model: new_reason.");
    expect(deferralReason({ ...deferred, deferred: false, reason: null, servedFrom: "student" })).toBe("Not deferred: the student answered.");
    expect(deferralReason({ ...deferred, deferred: false, reason: null, mode: "shadow" })).toBe("Not deferred: the deployment runs in shadow mode, so the cloud model answered.");
  });
});

describe("request actions", () => {
  test("a review candidate keys on the request hash and carries both answers", () => {
    expect(reviewCandidateFromRequest(deferred)).toEqual({
      inputHash: "aaaa000000000002",
      input: { requestHash: "aaaa000000000002", note: "the gateway logs only a hash of the request" },
      outputs: { "student (capitals-v2)": "Lyon", "cloud (cloud-large)": "Paris" },
    });
  });

  test("a dataset case expects the cloud answer when there is one and records where it came from", () => {
    expect(caseFromRequest(deferred)).toEqual({
      input: { requestHash: "aaaa000000000002" },
      expected: "Paris",
      metadata: {
        source: "production",
        requestHash: "aaaa000000000002",
        ts: "2026-11-23T10:00:00.000Z",
        task: "capitals",
        deferred: true,
        reason: "low_confidence",
        studentOutput: "Lyon",
        answeredBy: "cloud-large",
      },
    });
    const student = { ...deferred, deferred: false, reason: null, cloudOutput: null, cloudModel: null, servedFrom: "student", answeredBy: "capitals-v2" };
    expect(caseFromRequest(student).expected).toBe("Lyon");
  });
});
