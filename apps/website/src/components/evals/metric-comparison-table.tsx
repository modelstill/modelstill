import { differenceDomain } from "@modelstill/ui/blocks/comparison-summary";
import { IntervalValue } from "@modelstill/ui/blocks/interval-value";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@modelstill/ui/components/table";
import { VerdictBadge } from "@/components/badges";
import { ChangeCounts } from "@/components/evals/change-counts";
import type { MetricComparison } from "@/lib/api";
import type { MetricFilter } from "@/lib/compare";
import { metricLabel } from "@/lib/format";

function signedNumber(value: number): string {
  const text = value.toFixed(3);
  return value > 0 && Number(text) !== 0 ? `+${text}` : text;
}

function RunEstimate({ estimate }: { estimate: MetricComparison["before"] }) {
  if (!estimate) return <span className="text-muted-foreground">not logged</span>;
  return <IntervalValue mean={estimate.value} low={estimate.low} high={estimate.high} className="justify-end" />;
}

function Difference({ metric }: { metric: MetricComparison }) {
  if (metric.difference === null) return <span className="text-muted-foreground">n/a</span>;
  if (metric.low === null || metric.high === null) {
    return (
      <span className="inline-flex flex-col items-end gap-0.5">
        <span className="tabular-nums">{signedNumber(metric.difference)}</span>
        <span className="text-xs text-muted-foreground">no per-case scores, so no paired interval</span>
      </span>
    );
  }
  return (
    <IntervalValue
      mean={metric.difference}
      low={metric.low}
      high={metric.high}
      signed
      domain={differenceDomain({ low: metric.low, high: metric.high })}
      className="justify-end"
    />
  );
}

function Cases({ metric, onFilter }: { metric: MetricComparison; onFilter?: (filter: MetricFilter) => void }) {
  if (metric.improved === null || metric.improved === undefined || metric.regressed === null || metric.regressed === undefined) {
    return <span className="text-xs text-muted-foreground">n/a</span>;
  }
  return (
    <ChangeCounts
      improved={metric.improved}
      regressed={metric.regressed}
      onPick={onFilter && ((direction) => onFilter({ metric: metric.name, direction }))}
    />
  );
}

export function MetricComparisonTable({ metrics, onFilter }: { metrics: MetricComparison[]; onFilter?: (filter: MetricFilter) => void }) {
  if (metrics.length === 0) {
    return <p className="rounded-lg border bg-card px-4 py-3 text-muted-foreground">Neither run logged named metrics; the headline uses the per-case score.</p>;
  }
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="px-4 text-muted-foreground">Metric</TableHead>
            <TableHead className="px-4 text-right text-muted-foreground">Before</TableHead>
            <TableHead className="px-4 text-right text-muted-foreground">After</TableHead>
            <TableHead className="px-4 text-right text-muted-foreground">Difference</TableHead>
            <TableHead className="px-4 text-muted-foreground">Cases against before</TableHead>
            <TableHead className="px-4 text-muted-foreground">Verdict</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {metrics.map((metric) => (
            <TableRow key={metric.name} data-testid="metric-row" data-metric={metric.name} className="align-top">
              <TableCell className="px-4 py-2">
                <span className="flex flex-col">
                  <span className="font-medium">{metricLabel(metric.name)}</span>
                  <span className="text-xs text-muted-foreground">{metric.paired ? "paired per case" : "run-level values"}</span>
                </span>
              </TableCell>
              <TableCell className="px-4 py-2 text-right">
                <RunEstimate estimate={metric.before} />
              </TableCell>
              <TableCell className="px-4 py-2 text-right">
                <RunEstimate estimate={metric.after} />
              </TableCell>
              <TableCell className="px-4 py-2 text-right">
                <Difference metric={metric} />
              </TableCell>
              <TableCell className="px-4 py-1.5">
                <Cases metric={metric} onFilter={onFilter} />
              </TableCell>
              <TableCell className="px-4 py-2">
                {metric.verdict ? <VerdictBadge verdict={metric.verdict} /> : <span className="text-xs text-muted-foreground">needs per-case scores</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
