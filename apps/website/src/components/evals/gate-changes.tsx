import { ChangeCounts } from "@/components/evals/change-counts";
import type { MetricChange } from "@/lib/api";
import { metricLabel } from "@/lib/format";
import { compareHref } from "@/lib/nav";

export function GateChanges({
  slug,
  before,
  after,
  changes,
}: {
  slug: string;
  before: string;
  after: string;
  changes: MetricChange[];
}) {
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5">
      <p className="text-xs text-muted-foreground">Cases against the baseline run; pick a count to see those cases.</p>
      <ul className="flex flex-wrap gap-x-5 gap-y-1">
        {changes.map((change) => (
          <li key={change.name} data-testid="gate-change" data-metric={change.name} className="flex items-center gap-2">
            <span className="text-[13px] font-medium">{change.name === "score" ? "case score" : metricLabel(change.name)}</span>
            <ChangeCounts
              improved={change.improved}
              regressed={change.regressed}
              hrefFor={(direction) => compareHref(slug, before, after, { metric: change.name, direction })}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
