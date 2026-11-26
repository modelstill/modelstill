"use client";

import { useMemo, type ReactNode } from "react";
import {
  BarSparkline,
  DeltaLine,
  GradientBars,
  HeatmapGrid,
  LabelledBars,
  MetricWidget,
  ShareBar,
  ShareTable,
  TickProgress,
  WidgetPanel,
} from "@modelstill/ui/blocks/metric-widget";
import { Skeleton } from "@modelstill/ui/components/skeleton";
import { pointsDelta, relativeDelta } from "@modelstill/ui/lib/delta";
import type { Resource } from "@/lib/use-api";
import { useResource } from "@/lib/use-api";
import { useCasesApi } from "@/lib/use-cases-api";
import { formatShare } from "@/lib/interval";
import { metricLabel } from "@/lib/format";
import { dayRange, formatCost, formatLatency, requestSearch } from "@/lib/requests";
import { costSplit, deferralShare, gateOutcomes, hourlyCells, latencyTrend, passRateTrend, reviewProgress, splitWindows } from "@/lib/widgets";

const DAY_HOURS = 24;
const REQUEST_SAMPLE = 200;

function Pending<T>({ resource, children }: { resource: Resource<T>; children: (data: T) => ReactNode }) {
  if (resource.status === "ready") return children(resource.data);
  if (resource.status === "error") return <span className="text-[12.5px] text-muted-foreground">Could not load: {resource.error.message}</span>;
  return <Skeleton className="h-28 w-full" />;
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-[12.5px] text-muted-foreground">{children}</p>;
}

export function TaskWidgets({ slug }: { slug: string }) {
  const cases = useCasesApi();
  const evalRuns = useResource((api) => api.listEvalRuns(slug), [slug]);
  const traffic = useResource((api) => api.getTraffic(slug, DAY_HOURS * 2), [slug, "traffic-48"]);
  const queue = useResource((api) => api.listReviewQueue(slug), [slug]);
  const gates = useResource((api) => api.listGates(slug), [slug]);
  const search = useMemo(() => requestSearch({ task: slug, deferred: "all", ...dayRange(new Date(), 1) }, null, REQUEST_SAMPLE), [slug]);
  const requests = useResource(() => cases.listRequests(search), [search, "widget-requests"]);

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <MetricWidget title="Pass rate" description="Mean score of each eval run, newest highlighted.">
        <Pending resource={evalRuns}>
          {(runs) => {
            const trend = passRateTrend(runs);
            const latest = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
            if (trend.latest === null) return <Quiet>No eval run recorded yet.</Quiet>;
            return (
              <WidgetPanel
                label={metricLabel(latest?.primaryMetric ?? null)}
                value={trend.latest.toFixed(3)}
                delta={<DeltaLine delta={relativeDelta(trend.latest, trend.previous)} context="vs previous run" />}
              >
                <BarSparkline values={trend.values} />
              </WidgetPanel>
            );
          }}
        </Pending>
      </MetricWidget>

      <MetricWidget title="Deferral share" description="Calls sent to the cloud model, by hour over the last day.">
        <Pending resource={traffic}>
          {(data) => {
            const { current, previous } = splitWindows(data.buckets, DAY_HOURS);
            const share = deferralShare(current);
            if (share === null) return <Quiet>No traffic in the last day.</Quiet>;
            return (
              <WidgetPanel
                label="Deferred to the cloud"
                value={formatShare(share)}
                unit="of calls"
                delta={<DeltaLine delta={pointsDelta(share, deferralShare(previous), { higherIsBetter: false })} context="vs the day before" />}
              >
                <HeatmapGrid cells={hourlyCells(current, DAY_HOURS, (bucket) => bucket.deferred)} columns={12} />
              </WidgetPanel>
            );
          }}
        </Pending>
      </MetricWidget>

      <MetricWidget title="Cost" description="Spend of the latest calls, split between the student and the cloud.">
        <Pending resource={requests}>
          {(page) => {
            const split = costSplit(page.requests);
            if (split.count === 0) return <Quiet>No calls in the last day.</Quiet>;
            const segments = [
              { key: "student", label: "Student", value: split.student, tone: "chart-1" as const, display: formatCost(split.student) },
              { key: "cloud", label: "Cloud", value: split.cloud, tone: "chart-4" as const, display: formatCost(split.cloud) },
            ];
            return (
              <WidgetPanel label="Last day" value={formatCost(split.total)} unit={`${split.count} calls`}>
                <ShareBar segments={segments} />
                <ShareTable heading="Answered by" valueHeading="Cost" segments={segments} />
              </WidgetPanel>
            );
          }}
        </Pending>
      </MetricWidget>

      <MetricWidget title="Latency" description="Student p95 by hour, compared with the hours before.">
        <Pending resource={traffic}>
          {(data) => {
            const trend = latencyTrend(data.buckets, 12);
            if (trend.latest === null) return <Quiet>No student latency logged.</Quiet>;
            return (
              <WidgetPanel
                label="Student p95"
                value={formatLatency(trend.latest)}
                delta={<DeltaLine delta={relativeDelta(trend.latest, trend.previous, { higherIsBetter: false })} context="vs earlier hours" />}
              >
                <GradientBars values={trend.values} />
              </WidgetPanel>
            );
          }}
        </Pending>
      </MetricWidget>

      <MetricWidget title="Review progress" description="Disagreements a reviewer has settled.">
        <Pending resource={queue}>
          {(items) => {
            const progress = reviewProgress(items);
            if (progress.total === 0) return <Quiet>Nothing was sent to review.</Quiet>;
            return (
              <WidgetPanel label="Decided" value={`${Math.round(progress.fraction * 100)}%`} unit={`${progress.decided} of ${progress.total}`}>
                <TickProgress value={progress.decided} max={progress.total} label="Review progress" />
              </WidgetPanel>
            );
          }}
        </Pending>
      </MetricWidget>

      <MetricWidget title="Gate outcomes" description="Every gate run for this task, by state.">
        <Pending resource={gates}>
          {(rows) => {
            if (rows.length === 0) return <Quiet>No gate has run yet.</Quiet>;
            const outcomes = gateOutcomes(rows);
            const checks = rows.flatMap((gate) => gate.checks);
            return (
              <WidgetPanel label="Gates" value={rows.length} unit="runs">
                <LabelledBars
                  rows={[
                    { key: "passed", label: "Passed", value: outcomes.passed, tone: "positive" },
                    { key: "failed", label: "Failed", value: outcomes.failed, tone: "negative" },
                    { key: "checks-ok", label: "Checks met", value: checks.filter((check) => check.passed).length, tone: "brand" },
                    { key: "checks-miss", label: "Checks missed", value: checks.filter((check) => !check.passed).length, tone: "warning" },
                  ]}
                />
              </WidgetPanel>
            );
          }}
        </Pending>
      </MetricWidget>
    </div>
  );
}
