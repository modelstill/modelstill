export type DeltaDirection = "up" | "down" | "flat";
export type DeltaTone = "positive" | "negative" | "neutral";

export type Delta = { magnitude: string; signed: string; direction: DeltaDirection; tone: DeltaTone };

export type DeltaOptions = { higherIsBetter?: boolean; digits?: number };

function usable(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function build(change: number, unit: string, { higherIsBetter = true, digits = 1 }: DeltaOptions): Delta {
  const rounded = Number(change.toFixed(digits));
  const direction: DeltaDirection = rounded > 0 ? "up" : rounded < 0 ? "down" : "flat";
  const magnitude = `${Math.abs(rounded).toFixed(digits)}${unit}`;
  const sign = direction === "up" ? "+" : direction === "down" ? "-" : "";
  const better = direction === "up" ? higherIsBetter : !higherIsBetter;
  return { magnitude, signed: `${sign}${magnitude}`, direction, tone: direction === "flat" ? "neutral" : better ? "positive" : "negative" };
}

export function relativeDelta(current: number | null | undefined, previous: number | null | undefined, options: DeltaOptions = {}): Delta | null {
  if (!usable(current) || !usable(previous) || previous === 0) return null;
  return build(((current - previous) / Math.abs(previous)) * 100, "%", options);
}

export function pointsDelta(current: number | null | undefined, previous: number | null | undefined, options: DeltaOptions = {}): Delta | null {
  if (!usable(current) || !usable(previous)) return null;
  return build((current - previous) * 100, " pts", options);
}
