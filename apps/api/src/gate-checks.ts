import { compareScores, metricChanges, type CaseScore, type MetricChange } from "./stats.ts";
import type { EvalRun, GateCheck, GateRecord } from "./store.ts";

export const WORST_CASE_VALUES: Record<string, number> = { flip_rate: 1, cost_ratio: 9, p95_latency_ms: 99999 };

export const WORST_CASE_REASON =
  "Not measured, so it was recorded at its failing worst-case value: a missing measurement can never pass the gate.";

const DIFFERENCE_CHECKS = new Set(["regression_vs_baseline", "paired_difference_vs_cloud_lower_bound"]);

export type DescribedCheck = Required<GateCheck>;

export type DescribedGate = Omit<GateRecord, "checks" | "report" | "evalRunId" | "previousEvalRunId"> & {
  checks: DescribedCheck[];
  evalRunId: string | null;
  previousEvalRunId: string | null;
  changes: MetricChange[] | null;
};

export type RunLookup = (id: string) => Promise<{ run: EvalRun; scores: CaseScore[] } | null>;

type Interval = { estimate: number; low: number; high: number };

function notMeasuredReasons(report: unknown): Map<string, string | null> {
  const listed = report && typeof report === "object" ? (report as Record<string, unknown>)["notMeasured"] : undefined;
  if (Array.isArray(listed)) return new Map(listed.filter((name) => typeof name === "string").map((name) => [name, null]));
  if (listed && typeof listed === "object") {
    return new Map(Object.entries(listed).map(([name, reason]) => [name, typeof reason === "string" ? reason : null]));
  }
  return new Map();
}

function measurement(check: GateCheck, reported: Map<string, string | null>): { measured: boolean; reason: string | null } {
  if (check.measured === false) return { measured: false, reason: check.reason ?? WORST_CASE_REASON };
  if (check.measured === true) return { measured: true, reason: check.reason ?? null };
  if (reported.has(check.name)) return { measured: false, reason: reported.get(check.name) ?? WORST_CASE_REASON };
  if (!check.passed && WORST_CASE_VALUES[check.name] === check.value) return { measured: false, reason: WORST_CASE_REASON };
  return { measured: true, reason: check.reason ?? null };
}

async function intervals(gate: GateRecord, lookup: RunLookup): Promise<Map<string, Interval>> {
  const found = new Map<string, Interval>();
  const run = gate.evalRunId ? await lookup(gate.evalRunId) : null;
  if (!run) return found;
  found.set("metric_lower_bound", { estimate: run.run.mean, low: run.run.low, high: run.run.high });
  const previous = gate.previousEvalRunId ? await lookup(gate.previousEvalRunId) : null;
  if (!previous) return found;
  try {
    const comparison = compareScores(previous.scores, run.scores);
    const interval = { estimate: comparison.difference, low: comparison.low, high: comparison.high };
    for (const name of DIFFERENCE_CHECKS) found.set(name, interval);
  } catch {
    return found;
  }
  return found;
}

async function changesAgainstBaseline(gate: GateRecord, lookup: RunLookup): Promise<MetricChange[] | null> {
  if (!gate.evalRunId || !gate.previousEvalRunId) return null;
  const [run, previous] = await Promise.all([lookup(gate.evalRunId), lookup(gate.previousEvalRunId)]);
  if (!run || !previous) return null;
  try {
    return metricChanges(
      { metrics: previous.run.metrics, scores: previous.scores },
      { metrics: run.run.metrics, scores: run.scores },
    );
  } catch {
    return null;
  }
}

export async function describeGate(gate: GateRecord, lookup: RunLookup): Promise<DescribedGate> {
  const { report, checks, evalRunId, previousEvalRunId, ...rest } = gate;
  const reported = notMeasuredReasons(report);
  const [known, changes] = await Promise.all([intervals(gate, lookup), changesAgainstBaseline(gate, lookup)]);
  return {
    ...rest,
    evalRunId: evalRunId ?? null,
    previousEvalRunId: previousEvalRunId ?? null,
    changes,
    checks: checks.map((check) => {
      const derived = known.get(check.name);
      const { measured, reason } = measurement(check, reported);
      return {
        name: check.name,
        threshold: check.threshold,
        value: check.value,
        passed: check.passed,
        estimate: check.estimate ?? (measured ? (derived?.estimate ?? null) : null),
        low: check.low ?? (measured ? (derived?.low ?? null) : null),
        high: check.high ?? (measured ? (derived?.high ?? null) : null),
        measured,
        reason,
      };
    }),
  };
}
