import { IntervalValue } from "@modelstill/ui/blocks/interval-value";
import type { EvalRun } from "@/lib/api";
import { metricLabel } from "@/lib/format";

type RunScoreProps = {
  run: Pick<EvalRun, "mean" | "low" | "high" | "primaryMetric">;
  digits?: number;
};

export function RunScore({ run, digits }: RunScoreProps) {
  return (
    <span className="inline-flex items-center gap-2">
      <span data-slot="metric-name" className="whitespace-nowrap text-muted-foreground">
        {metricLabel(run.primaryMetric)}
      </span>
      <IntervalValue mean={run.mean} low={run.low} high={run.high} digits={digits} />
    </span>
  );
}
