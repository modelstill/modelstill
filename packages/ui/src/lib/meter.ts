export type MeterTone = "positive" | "brand" | "warning" | "negative" | "idle";

export type ScoreBands = { good: number; fair: number };
export type UsageBands = { warn: number; full: number };

export const SCORE_BANDS: ScoreBands = { good: 0.9, fair: 0.6 };
export const USAGE_BANDS: UsageBands = { warn: 0.75, full: 1 };

function usable(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function meterRatio(value: number | null | undefined, max = 1): number {
  if (!usable(value) || !usable(max) || max <= 0) return 0;
  return Math.min(1, Math.max(0, value / max));
}

export function filledSegments(value: number | null | undefined, max: number, segments: number): number {
  const ratio = meterRatio(value, max);
  if (ratio === 0) return 0;
  return Math.min(segments, Math.max(1, Math.round(ratio * segments)));
}

export function heatLevel(value: number | null | undefined, max: number, levels = 4): number {
  return filledSegments(value, max, levels);
}

export function scoreTone(value: number | null | undefined, max = 1, bands: ScoreBands = SCORE_BANDS): MeterTone {
  if (!usable(value)) return "idle";
  const ratio = meterRatio(value, max);
  if (ratio >= bands.good) return "positive";
  if (ratio >= bands.fair) return "brand";
  return "warning";
}

export function usageTone(used: number | null | undefined, limit: number | null | undefined, bands: UsageBands = USAGE_BANDS): MeterTone {
  if (!usable(used) || !usable(limit) || limit <= 0) return "idle";
  const ratio = used / limit;
  if (ratio >= bands.full) return "negative";
  if (ratio >= bands.warn) return "warning";
  return "brand";
}

export const TONE_FILL: Record<MeterTone, string> = {
  positive: "bg-positive",
  brand: "bg-brand",
  warning: "bg-status-warn",
  negative: "bg-negative",
  idle: "bg-mark",
};

export const TONE_TEXT: Record<MeterTone, string> = {
  positive: "text-positive",
  brand: "text-brand-text",
  warning: "text-status-warn",
  negative: "text-negative",
  idle: "text-muted-foreground",
};
