import type { CompareCase, Comparison } from "./api";
import { formatSignedInterval } from "./interval";

export function isChangedCase(entry: Pick<CompareCase, "before" | "after">): boolean {
  return JSON.stringify(entry.before) !== JSON.stringify(entry.after);
}

export function orderPair(
  runs: readonly { id: string; createdAt: string }[],
  selected: readonly string[],
): { before: string; after: string } | null {
  if (selected.length !== 2) return null;
  const picked = runs.filter((run) => selected.includes(run.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (picked.length !== 2) return null;
  return { before: picked[0]!.id, after: picked[1]!.id };
}

export function toggleSelection(selected: readonly string[], id: string): string[] {
  if (selected.includes(id)) return selected.filter((entry) => entry !== id);
  return [...selected, id].slice(-2);
}

export function changedCases<T extends Pick<CompareCase, "before" | "after">>(cases: readonly T[]): T[] {
  return cases.filter(isChangedCase);
}

export function applySelection(previous: readonly string[], next: readonly string[]): string[] {
  const kept = previous.filter((id) => next.includes(id));
  const added = next.filter((id) => !previous.includes(id));
  return added.reduce<string[]>((selection, id) => toggleSelection(selection, id), kept);
}

export type CaseChange = "same" | "fixed" | "broken" | "changed";

function asNumber(value: CompareCase["before"]): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  return null;
}

export function caseChange(entry: Pick<CompareCase, "before" | "after">): CaseChange {
  if (!isChangedCase(entry)) return "same";
  const before = asNumber(entry.before);
  const after = asNumber(entry.after);
  if (before === null || after === null) return "changed";
  return after > before ? "fixed" : "broken";
}

export type CaseFilter = "all" | "fixed" | "broken" | "unchanged";

export function caseDelta(entry: Pick<CompareCase, "before" | "after">): number | null {
  const before = asNumber(entry.before);
  const after = asNumber(entry.after);
  return before === null || after === null ? null : after - before;
}

function filterOf(entry: Pick<CompareCase, "before" | "after">): Exclude<CaseFilter, "all"> | null {
  const delta = caseDelta(entry);
  if (delta === null) return isChangedCase(entry) ? null : "unchanged";
  if (delta > 0) return "fixed";
  if (delta < 0) return "broken";
  return "unchanged";
}

export function casesIn<T extends Pick<CompareCase, "before" | "after">>(cases: readonly T[], filter: CaseFilter): T[] {
  if (filter === "all") return [...cases];
  return cases.filter((entry) => filterOf(entry) === filter);
}

export function changeCounts(cases: readonly Pick<CompareCase, "before" | "after">[]): Record<CaseFilter, number> {
  return {
    all: cases.length,
    fixed: casesIn(cases, "fixed").length,
    broken: casesIn(cases, "broken").length,
    unchanged: casesIn(cases, "unchanged").length,
  };
}

export function sortByRegression<T extends Pick<CompareCase, "before" | "after">>(cases: readonly T[]): T[] {
  const rank = (entry: T) => caseDelta(entry) ?? 0;
  return [...cases].sort((left, right) => rank(left) - rank(right));
}

export function formatPValue(value: number): string {
  if (value < 0.001) return "p < 0.001";
  if (value < 0.1) return `p = ${value.toFixed(3)}`;
  return `p = ${value.toFixed(2)}`;
}

const VERDICT_SENTENCE: Record<Comparison["verdict"], string> = {
  better: "The interval is above zero, so after is better.",
  worse: "The interval is below zero, so after is worse.",
  no_detectable_difference: "The interval includes zero, so these cases cannot tell the runs apart.",
};

export function headlineSentence(
  comparison: Pick<Comparison, "difference" | "low" | "high" | "verdict" | "pairedCases" | "cases">,
): string {
  const count = comparison.pairedCases ?? comparison.cases.length;
  const difference = formatSignedInterval({ mean: comparison.difference, low: comparison.low, high: comparison.high }, { digits: 3 });
  return `After scores ${difference} against before on ${count} paired cases. ${VERDICT_SENTENCE[comparison.verdict]}`;
}

export type MetricDirection = "improved" | "regressed";

export type MetricFilter = { metric: string; direction: MetricDirection };

function metricPair(entry: CompareCase, metric: string): { before: number; after: number } | null {
  if (metric === "score") {
    const before = asNumber(entry.before);
    const after = asNumber(entry.after);
    return before === null || after === null ? null : { before, after };
  }
  return entry.metrics?.[metric] ?? null;
}

export function casesForMetric<T extends CompareCase>(cases: readonly T[], filter: MetricFilter): T[] {
  return cases.filter((entry) => {
    const pair = metricPair(entry, filter.metric);
    if (!pair) return false;
    return filter.direction === "improved" ? pair.after > pair.before : pair.after < pair.before;
  });
}

const DIRECTIONS: readonly string[] = ["improved", "regressed"];

export function metricFilterFrom(params: Pick<URLSearchParams, "get">): MetricFilter | null {
  const metric = params.get("metric");
  const change = params.get("change");
  if (!metric || !change || !DIRECTIONS.includes(change)) return null;
  return { metric, direction: change as MetricDirection };
}

export function textLines(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.split("\n");
}

export type DiffLine = { kind: "same" | "removed" | "added"; text: string };

function commonLengths(left: readonly string[], right: readonly string[]): number[][] {
  const table = Array.from({ length: left.length + 1 }, () => Array.from({ length: right.length + 1 }, () => 0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i]![j] = left[i] === right[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  return table;
}

export function lineDiff(expected: readonly string[], output: readonly string[]): DiffLine[] {
  const table = commonLengths(expected, output);
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < expected.length && j < output.length) {
    if (expected[i] === output[j]) {
      lines.push({ kind: "same", text: expected[i]! });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      lines.push({ kind: "removed", text: expected[i]! });
      i += 1;
    } else {
      lines.push({ kind: "added", text: output[j]! });
      j += 1;
    }
  }
  for (; i < expected.length; i += 1) lines.push({ kind: "removed", text: expected[i]! });
  for (; j < output.length; j += 1) lines.push({ kind: "added", text: output[j]! });
  return lines;
}
