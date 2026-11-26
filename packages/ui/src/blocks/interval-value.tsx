import { cn } from "@modelstill/ui/lib/utils";
import { formatInterval, formatSignedInterval, intervalBarGeometry, type Domain } from "@modelstill/ui/lib/interval";

export type IntervalFormat = "number" | "percent";

export type IntervalValueProps = {
  mean: number | null;
  low: number | null;
  high: number | null;
  digits?: number;
  signed?: boolean;
  format?: IntervalFormat;
  domain?: Domain;
  compare?: number;
  bar?: boolean;
  className?: string;
};

function percent(value: number, digits: number): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function formatText({ mean, low, high, digits, signed, format }: Required<Pick<IntervalValueProps, "signed" | "format">> & IntervalValueProps): string {
  if (format === "percent") {
    if (mean === null) return "n/a";
    const places = digits ?? 1;
    if (low === null || high === null) return `${percent(mean, places)} [interval missing]`;
    return `${percent(mean, places)} [${percent(low, places)}, ${percent(high, places)}]`;
  }
  const estimate = { mean, low, high };
  return signed ? formatSignedInterval(estimate, { digits }) : formatInterval(estimate, { digits });
}

export type IntervalBarProps = {
  mean: number;
  low: number;
  high: number;
  domain?: Domain;
  compare?: number;
  className?: string;
};

export function IntervalBar({ mean, low, high, domain = { min: 0, max: 1 }, compare, className }: IntervalBarProps) {
  const geometry = intervalBarGeometry({ mean, low, high }, domain);
  const position = (value: number) => intervalBarGeometry({ mean: value, low: value, high: value }, domain).mean;
  const zero = domain.min < 0 && domain.max > 0 ? position(0) : null;
  return (
    <span
      aria-hidden="true"
      data-testid="interval-bar"
      className={cn("relative inline-block h-1 w-14 shrink-0 rounded-full bg-foreground/10 align-middle", className)}
    >
      {zero !== null && (
        <span data-testid="interval-zero" className="absolute -inset-y-1 w-px bg-muted-foreground/60" style={{ left: `${zero}%` }} />
      )}
      <span className="absolute inset-y-0 rounded-full bg-primary/45" style={{ left: `${geometry.left}%`, width: `${geometry.width}%` }} />
      <span className="absolute -inset-y-0.5 w-0.5 -translate-x-1/2 rounded-full bg-primary" style={{ left: `${geometry.mean}%` }} />
      {compare !== undefined && (
        <span
          data-testid="interval-compare"
          className="absolute -inset-y-1 w-px -translate-x-1/2 bg-foreground"
          style={{ left: `${position(compare)}%` }}
        />
      )}
    </span>
  );
}

export function IntervalValue({
  mean,
  low,
  high,
  digits,
  signed = false,
  format = "number",
  domain,
  compare,
  bar = true,
  className,
}: IntervalValueProps) {
  const text = formatText({ mean, low, high, digits, signed, format });
  const drawable = bar && mean !== null && low !== null && high !== null;
  return (
    <span data-slot="interval-value" className={cn("inline-flex items-center gap-2 tabular-nums", className)}>
      <span className="whitespace-nowrap">{text}</span>
      {drawable && <IntervalBar mean={mean} low={low} high={high} domain={domain} compare={compare} />}
    </span>
  );
}
