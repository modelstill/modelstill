import { differenceDomain } from "@modelstill/ui/blocks/comparison-summary";
import { IntervalValue } from "@modelstill/ui/blocks/interval-value";
import { StatCard } from "@modelstill/ui/blocks/stat-card";
import { VerdictBadge } from "@/components/badges";
import type { Comparison } from "@/lib/api";
import { formatPValue, headlineSentence } from "@/lib/compare";

export function ComparisonHeadline({ comparison }: { comparison: Comparison }) {
  const { difference, low, high, verdict, fixed, broken, signTest } = comparison;
  const paired = comparison.pairedCases ?? comparison.cases.length;
  return (
    <div data-slot="comparison-headline" className="flex flex-col gap-3">
      <p data-testid="comparison-sentence" className="text-sm text-foreground">
        {headlineSentence(comparison)}
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-[minmax(0,1.7fr)_repeat(3,minmax(0,1fr))]">
        <StatCard
          className="col-span-2 lg:col-span-1"
          label="Paired difference, after minus before"
          value={<IntervalValue mean={difference} low={low} high={high} digits={3} signed domain={differenceDomain({ low, high })} />}
          sublabel={`bootstrap 95% interval over ${paired} paired cases`}
        />
        <StatCard label="Verdict" value={<VerdictBadge verdict={verdict} />} sublabel="set by the interval, not the mean" />
        <StatCard
          label="Fixed / broken"
          value={
            <span className="inline-flex items-baseline gap-1.5">
              <span className="text-status-ok">{fixed}</span>
              <span className="text-sm text-muted-foreground">/</span>
              <span className="text-status-fail">{broken}</span>
            </span>
          }
          sublabel="cases that changed score"
        />
        <StatCard
          label="Sign test"
          value={
            <span data-testid="sign-test" className="inline-flex flex-col gap-1">
              <span>{signTest ? formatPValue(signTest.pValue) : "n/a"}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {fixed} fixed, {broken} broken
              </span>
            </span>
          }
          sublabel="exact, two-sided"
        />
      </div>
    </div>
  );
}
