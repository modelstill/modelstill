import type { HistogramBin, RunCase } from "./api";

export const CASE_PAGE_SIZE = 100;

export function previewText(value: unknown, max = 80): string {
  if (value === null || value === undefined) return "";
  const text = (typeof value === "string" ? value : JSON.stringify(value)).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function scoreColumns(cases: readonly Pick<RunCase, "metrics">[]): string[] {
  const names = new Set(cases.flatMap((entry) => Object.keys(entry.metrics)));
  return ["score", ...[...names].sort()];
}

export function isUnitScore(cases: readonly Pick<RunCase, "score" | "metrics">[], name: string): boolean {
  const values = cases.map((entry) => (name === "score" ? entry.score : entry.metrics[name])).filter((value): value is number => value !== undefined);
  return values.length > 0 && values.every((value) => value >= 0 && value <= 1);
}

function edge(value: number): string {
  return String(Number(value.toFixed(2)));
}

export type HistogramRow = HistogramBin & { range: string };

export function histogramRows(bins: readonly HistogramBin[]): HistogramRow[] {
  return bins.map((bin) => ({ range: bin.low === bin.high ? edge(bin.low) : `${edge(bin.low)}–${edge(bin.high)}`, ...bin }));
}

type RunRef = { id: string; createdAt: string; split: string };

export function baselineFor<T extends RunRef>(runs: readonly T[], id: string): T | null {
  const run = runs.find((candidate) => candidate.id === id);
  if (!run) return null;
  const older = runs
    .filter((candidate) => candidate.split === run.split && candidate.createdAt < run.createdAt)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return older[0] ?? null;
}

export function pageLabel(offset: number, count: number, total: number): string {
  if (count === 0) return `0 of ${total}`;
  return `${offset + 1}–${offset + count} of ${total}`;
}
