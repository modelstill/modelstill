export type Estimate = {
  mean: number | null;
  low: number | null;
  high: number | null;
};

export type FormatOptions = { digits?: number };

function fixed(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return Number(text) === 0 ? (0).toFixed(digits) : text;
}

function signed(value: number, digits: number): string {
  const text = fixed(value, digits);
  return Number(text) > 0 ? `+${text}` : text;
}

function render(estimate: Estimate, digits: number, show: (value: number, digits: number) => string): string {
  if (estimate.mean === null) return "n/a";
  const mean = show(estimate.mean, digits);
  if (estimate.low === null || estimate.high === null) return `${mean} [interval missing]`;
  return `${mean} [${show(estimate.low, digits)}, ${show(estimate.high, digits)}]`;
}

export function formatInterval(estimate: Estimate, options: FormatOptions = {}): string {
  return render(estimate, options.digits ?? 2, fixed);
}

export function formatSignedInterval(estimate: Estimate, options: FormatOptions = {}): string {
  return render(estimate, options.digits ?? 2, signed);
}

export type Domain = { min: number; max: number };

export type IntervalGeometry = { left: number; width: number; mean: number };

export function intervalBarGeometry(
  estimate: { mean: number; low: number; high: number },
  domain: Domain = { min: 0, max: 1 },
): IntervalGeometry {
  const span = domain.max - domain.min;
  const percent = (value: number) => {
    const clamped = Math.min(domain.max, Math.max(domain.min, value));
    return Math.round(((clamped - domain.min) / span) * 10000) / 100;
  };
  const left = percent(estimate.low);
  return { left, width: Math.round((percent(estimate.high) - left) * 100) / 100, mean: percent(estimate.mean) };
}

export function formatShare(share: number | null): string {
  if (share === null) return "n/a";
  return `${(share * 100).toFixed(1)}%`;
}
