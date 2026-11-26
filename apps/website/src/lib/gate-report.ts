import { formatCheckNumber, thresholdLabel } from "@modelstill/ui/blocks/gate-checks";
import { pointsDelta, type Delta } from "@modelstill/ui/lib/delta";
import type { GateCheck, MetricComparison, MetricHistogram, Verdict } from "./api";

export type CheckHighlight = { name: string; measured: string; threshold: string; passed: boolean };

export function checkHighlight(check: GateCheck): CheckHighlight {
  return {
    name: check.name,
    measured: check.measured && check.value !== null ? formatCheckNumber(check.value) : "not measured",
    threshold: thresholdLabel(check),
    passed: check.passed,
  };
}

export type MetricInsight = { name: string; value: string; delta: Delta | null };

export function metricInsight(metric: MetricComparison): MetricInsight {
  return {
    name: metric.name,
    value: metric.after ? metric.after.value.toFixed(3) : "n/a",
    delta: pointsDelta(metric.after?.value, metric.before?.value),
  };
}

const VERDICT_WORDS: Record<Verdict, string> = { better: "better", worse: "worse", no_detectable_difference: "no detectable difference" };

export function verdictWords(verdict: Verdict | null | undefined): string {
  return verdict ? VERDICT_WORDS[verdict] : "no verdict";
}

export function binCounts(histograms: readonly MetricHistogram[], metric: string): number[] {
  return histograms.find((entry) => entry.metric === metric)?.bins.map((bin) => bin.count) ?? [];
}
