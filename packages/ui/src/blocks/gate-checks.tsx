import { CheckCircleIcon, ProhibitIcon, XCircleIcon } from "@phosphor-icons/react";
import { Badge } from "@modelstill/ui/components/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@modelstill/ui/components/table";
import { cn } from "@modelstill/ui/lib/utils";
import { differenceDomain } from "./comparison-summary";
import { IntervalValue } from "./interval-value";
import { PassBadge } from "./verdict-badge";

export type GateCheck = {
  name: string;
  threshold: number | null;
  value: number | null;
  passed: boolean;
  estimate?: number | null;
  low?: number | null;
  high?: number | null;
  measured?: boolean;
  reason?: string | null;
};

type Direction = "min" | "max" | null;

const KNOWN_DIRECTION: Record<string, Direction> = {
  metric_lower_bound: "min",
  regression_vs_baseline: "min",
  paired_difference_vs_cloud_lower_bound: "min",
  judge_human_kappa: "min",
  flip_rate: "max",
  cost_ratio: "max",
  p95_latency_ms: "max",
};

export function formatCheckNumber(value: number | null): string {
  if (value === null) return "n/a";
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function direction(check: GateCheck): Direction {
  const known = KNOWN_DIRECTION[check.name];
  if (known) return known;
  if (check.threshold === null || check.value === null || check.value === check.threshold) return null;
  const above = check.value > check.threshold;
  return above === check.passed ? "min" : "max";
}

export function thresholdLabel(check: GateCheck): string {
  const text = formatCheckNumber(check.threshold);
  if (check.threshold === null) return text;
  const side = direction(check);
  if (side === "min") return `at least ${text}`;
  if (side === "max") return `at most ${text}`;
  return text;
}

function isMeasured(check: GateCheck): boolean {
  return check.measured !== false;
}

export function gateSummary(checks: readonly GateCheck[]): string {
  const failed = checks.filter((check) => !check.passed).length;
  const unmeasured = checks.filter((check) => !isMeasured(check)).length;
  const base = `${checks.length} checks, ${failed} failed`;
  return unmeasured > 0 ? `${base}, ${unmeasured} not measured` : base;
}

function hasInterval(check: GateCheck): check is GateCheck & { estimate: number; low: number; high: number } {
  return typeof check.estimate === "number" && typeof check.low === "number" && typeof check.high === "number";
}

function CheckInterval({ check }: { check: GateCheck }) {
  if (!isMeasured(check)) return <span className="text-muted-foreground">no estimate</span>;
  if (!hasInterval(check)) return <span className="text-muted-foreground">exact value</span>;
  const signed = check.low < 0 || check.estimate < 0;
  return (
    <IntervalValue
      mean={check.estimate}
      low={check.low}
      high={check.high}
      digits={3}
      signed={signed}
      domain={signed ? differenceDomain(check) : undefined}
      compare={check.threshold ?? undefined}
      className="justify-end"
    />
  );
}

export function GateChecks({ checks, showSummary = true, className }: { checks: GateCheck[]; showSummary?: boolean; className?: string }) {
  if (checks.length === 0) return <p className="px-3 py-2 text-muted-foreground">This gate stored no checks.</p>;
  return (
    <div data-slot="gate-checks" className={cn("flex flex-col", className)}>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="px-3 text-muted-foreground">Check</TableHead>
            <TableHead className="px-3 text-right text-muted-foreground">Threshold</TableHead>
            <TableHead className="px-3 text-right text-muted-foreground">Measured</TableHead>
            <TableHead className="px-3 text-right text-muted-foreground">Estimate, 95% interval</TableHead>
            <TableHead className="w-20 px-3 text-muted-foreground">Result</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {checks.map((check) => {
            const measured = isMeasured(check);
            return (
              <TableRow key={check.name} data-testid="gate-check" data-passed={check.passed} data-measured={measured} className="align-top">
                <TableCell className="px-3 py-1.5">
                  <div className="flex flex-col gap-1">
                    <span className="inline-flex items-center gap-2 font-mono text-xs">
                      {check.passed ? (
                        <CheckCircleIcon aria-hidden="true" className="size-3.5 text-success" />
                      ) : (
                        <XCircleIcon aria-hidden="true" className="size-3.5 text-destructive" />
                      )}
                      {check.name}
                    </span>
                    {!measured && (
                      <p data-testid="gate-check-reason" className="max-w-md pl-5.5 text-xs whitespace-normal text-muted-foreground">
                        {check.reason ?? "Not measured, so it was recorded at its failing worst-case value."}
                      </p>
                    )}
                  </div>
                </TableCell>
                <TableCell className="px-3 py-1.5 text-right whitespace-nowrap text-muted-foreground">{thresholdLabel(check)}</TableCell>
                <TableCell className={cn("px-3 py-1.5 text-right tabular-nums", !check.passed && "font-medium text-destructive")}>
                  {formatCheckNumber(check.value)}
                </TableCell>
                <TableCell className="px-3 py-1.5 text-right">
                  <CheckInterval check={check} />
                </TableCell>
                <TableCell className="px-3 py-1.5">
                  <div className="flex flex-wrap items-center gap-1">
                    <PassBadge passed={check.passed} />
                    {!measured && (
                      <Badge variant="warning">
                        <ProhibitIcon aria-hidden="true" />
                        not measured
                      </Badge>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {showSummary && <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">{gateSummary(checks)}</p>}
    </div>
  );
}
