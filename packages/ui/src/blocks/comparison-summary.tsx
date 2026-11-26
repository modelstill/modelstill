import { cn } from "@modelstill/ui/lib/utils";
import { IntervalValue } from "./interval-value";
import { StatCard } from "./stat-card";
import { VerdictBadge, type Verdict } from "./verdict-badge";

export type ComparisonSummaryProps = {
  difference: number;
  low: number;
  high: number;
  verdict: Verdict;
  fixed: number;
  broken: number;
  className?: string;
};

export function differenceDomain({ low, high }: { low: number; high: number }) {
  const reach = Math.max(Math.abs(low), Math.abs(high), 0.05) * 1.2;
  return { min: -reach, max: reach };
}

export function ComparisonSummary({ difference, low, high, verdict, fixed, broken, className }: ComparisonSummaryProps) {
  return (
    <div data-slot="comparison-summary" className={cn("grid grid-cols-2 gap-3 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]", className)}>
      <StatCard
        label="Difference, after minus before"
        value={<IntervalValue mean={difference} low={low} high={high} signed domain={differenceDomain({ low, high })} />}
        sublabel="paired, with its interval; tick marks zero"
      />
      <StatCard label="Verdict" value={<VerdictBadge verdict={verdict} />} sublabel="set by the interval" />
      <StatCard label="Fixed" value={fixed} sublabel="wrong before, right after" />
      <StatCard label="Broken" value={broken} sublabel="right before, wrong after" />
    </div>
  );
}
