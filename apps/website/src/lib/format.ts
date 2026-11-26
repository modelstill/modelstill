import { formatInterval } from "./interval";

export function shortHash(hash: string | null | undefined): string {
  if (!hash) return "n/a";
  const colon = hash.indexOf(":");
  if (colon === -1) return hash.slice(0, 12);
  return `${hash.slice(0, colon + 1)}${hash.slice(colon + 1, colon + 13)}`;
}

function parse(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "n/a";
  const date = parse(iso);
  if (!date) return iso;
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function formatHour(iso: string): string {
  const date = parse(iso);
  if (!date) return iso;
  return date.toISOString().slice(5, 16).replace("T", " ");
}

export function formatMs(ms: number | null): string {
  return ms === null ? "n/a" : `${Math.round(ms)} ms`;
}

const ACRONYMS = new Set(["auc", "mae", "mse", "rmse", "bleu", "rouge", "ndcg", "mrr"]);

function metricWord(word: string): string {
  return ACRONYMS.has(word) || /^[a-z]\d+$/.test(word) ? word.toUpperCase() : word;
}

export function metricLabel(name: string | null): string {
  if (!name) return "per-case mean";
  return name.split("_").filter(Boolean).map(metricWord).join(" ");
}

export function formatCanary(run: { passed: number; total: number; low: number; high: number }): string {
  const rate = run.total === 0 ? null : run.passed / run.total;
  return `${run.passed}/${run.total}, ${formatInterval({ mean: rate, low: run.low, high: run.high })}`;
}
