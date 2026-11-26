"use client";

import { useParams } from "next/navigation";
import { ArrowsLeftRightIcon, ChartBarIcon, FlaskIcon, ListChecksIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { SignedDelta } from "@modelstill/ui/blocks/metric-widget";
import { DeliverableCard, DenseBars, EntityChip, Footnote, HighlightItem, Highlights, InsightCard, ReportHeader, ReportSection } from "@modelstill/ui/blocks/report";
import { PassBadge } from "@/components/badges";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import type { Comparison, EvalRunDetail, Gate } from "@/lib/api";
import { formatDateTime, metricLabel } from "@/lib/format";
import { binCounts, checkHighlight, metricInsight, verdictWords } from "@/lib/gate-report";
import { compareHref, evalRunHref, taskSectionHref } from "@/lib/nav";
import { useResource, type LoadedResource, type Resource } from "@/lib/use-api";
import { useSlug } from "@/lib/use-slug";

function useGateId(): string {
  const params = useParams<{ gateId: string }>();
  return decodeURIComponent(params?.gateId ?? "");
}

function short(id: string): string {
  return id.slice(0, 8);
}

function ComparisonHighlights({ slug, gate, comparison, offset }: { slug: string; gate: Gate; comparison: Comparison; offset: number }) {
  if (!gate.evalRunId || !gate.previousEvalRunId) return null;
  const href = compareHref(slug, gate.previousEvalRunId, gate.evalRunId);
  return (
    <>
      <HighlightItem>
        <EntityChip icon={FlaskIcon} mono href={evalRunHref(slug, gate.evalRunId)}>
          run {short(gate.evalRunId)}
        </EntityChip>{" "}
        against{" "}
        <EntityChip icon={FlaskIcon} mono href={evalRunHref(slug, gate.previousEvalRunId)}>
          run {short(gate.previousEvalRunId)}
        </EntityChip>
        : <strong className="font-medium">{verdictWords(comparison.verdict)}</strong>, difference {comparison.difference.toFixed(3)} [{comparison.low.toFixed(3)}, {comparison.high.toFixed(3)}]
        <Footnote n={offset + 1} href={href} />
      </HighlightItem>
      <HighlightItem>
        <strong className="font-medium">{comparison.fixed}</strong> cases fixed and <strong className="font-medium">{comparison.broken}</strong> broken between the two runs
        <Footnote n={offset + 2} href={href} />
      </HighlightItem>
    </>
  );
}

function Report({ slug, gate, comparison, detail }: { slug: string; gate: Gate; comparison: LoadedResource<Comparison | null>; detail: Resource<EvalRunDetail | null> }) {
  const checks = gate.checks.map(checkHighlight);
  const ready = comparison.status === "ready" ? comparison.data : null;
  const run = detail.status === "ready" ? detail.data : null;
  const histograms = run ? run.histograms : [];
  return (
    <div className="mx-auto flex w-full max-w-[920px] flex-col gap-10 px-6 pt-12 pb-16">
      <ReportHeader
        title="Gate report"
        meta={
          <span className="flex flex-wrap items-center gap-2">
            <PassBadge passed={gate.passed} />
            {formatDateTime(gate.createdAt)} · {checks.length} checks, {checks.filter((check) => !check.passed).length} failed
          </span>
        }
      />

      <ReportSection title="Highlights">
        <Highlights>
          {checks.map((check, index) => (
            <HighlightItem key={check.name} note={index + 1}>
              <EntityChip icon={ShieldCheckIcon} mono>
                {check.name}
              </EntityChip>{" "}
              measured <strong className="font-medium">{check.measured}</strong>, needs {check.threshold}: {check.passed ? "met" : "missed"}
            </HighlightItem>
          ))}
          {ready && <ComparisonHighlights slug={slug} gate={gate} comparison={ready} offset={checks.length} />}
        </Highlights>
      </ReportSection>

      <ReportSection title="Insights">
        {comparison.status === "loading" && <LoadingState variant="cards" />}
        {comparison.status === "error" && <ErrorState error={comparison.error} onRetry={comparison.reload} />}
        {comparison.status === "ready" && !ready && !run && <EmptyState icon={ChartBarIcon} title="No eval run" description="This gate was pushed without an eval run." />}
        {comparison.status === "ready" && !ready && run && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[["score", run.run.mean] as const, ...Object.entries(run.run.metrics).map(([name, estimate]) => [name, estimate.value] as const)].map(([name, value]) => {
              const bins = binCounts(histograms, name);
              return (
                <InsightCard key={name} icon={ChartBarIcon} label={name === "score" ? metricLabel(run.run.primaryMetric) : metricLabel(name)} value={value.toFixed(3)} delta={<span className="text-[12px] text-muted-foreground">no baseline</span>}>
                  {bins.length > 0 && <DenseBars values={bins} />}
                </InsightCard>
              );
            })}
          </div>
        )}
        {ready && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ready.metrics.map((metric) => {
              const insight = metricInsight(metric);
              const bins = binCounts(histograms, metric.name);
              return (
                <InsightCard key={metric.name} icon={ChartBarIcon} label={metricLabel(metric.name)} value={insight.value} delta={<SignedDelta delta={insight.delta} />}>
                  {bins.length > 0 && <DenseBars values={bins} />}
                </InsightCard>
              );
            })}
          </div>
        )}
      </ReportSection>

      <ReportSection title="Deliverables">
        <div className="grid gap-4 sm:grid-cols-3">
          {gate.evalRunId && gate.previousEvalRunId && (
            <DeliverableCard icon={ArrowsLeftRightIcon} caption="Case by case comparison" href={compareHref(slug, gate.previousEvalRunId, gate.evalRunId)} />
          )}
          {gate.evalRunId && <DeliverableCard icon={FlaskIcon} caption={`Gated run · ${short(gate.evalRunId)}`} href={evalRunHref(slug, gate.evalRunId)} />}
          <DeliverableCard icon={ListChecksIcon} caption="Review queue" href={taskSectionHref(slug, "review")} />
        </div>
      </ReportSection>

      <ReportSection title="Sources">
        <ol className="flex flex-col gap-1.5 text-[13px] text-muted-foreground">
          {checks.map((check, index) => (
            <li key={check.name} className="flex gap-2">
              <span className="w-5 font-mono tabular-nums">{index + 1}</span>
              <span>
                Gate check <span className="font-mono">{check.name}</span>, stored with the gate: threshold {check.threshold}, measured {check.measured}.
              </span>
            </li>
          ))}
          {ready && (
            <>
              <li className="flex gap-2">
                <span className="w-5 font-mono tabular-nums">{checks.length + 1}</span>
                <span>Paired comparison of the two runs with a 95% bootstrap interval.</span>
              </li>
              <li className="flex gap-2">
                <span className="w-5 font-mono tabular-nums">{checks.length + 2}</span>
                <span>Cases scored in both runs, counted as fixed or broken.</span>
              </li>
            </>
          )}
        </ol>
      </ReportSection>
    </div>
  );
}

export default function GateReportPage() {
  const slug = useSlug();
  const gateId = useGateId();
  const gates = useResource((api) => api.listGates(slug), [slug]);
  const gate = gates.status === "ready" ? (gates.data.find((entry) => entry.id === gateId) ?? null) : undefined;
  const before = gate?.previousEvalRunId ?? null;
  const after = gate?.evalRunId ?? null;
  const comparison = useResource((api) => (before && after ? api.compareEvalRuns(before, after) : Promise.resolve(null)), [before ?? "", after ?? "", "gate-report"]);
  const detail = useResource((api) => (after ? api.getEvalRun(after) : Promise.resolve(null)), [after ?? "", "gate-report-run"]);

  if (gates.status === "error") return <ErrorState error={gates.error} onRetry={gates.reload} />;
  if (gate === undefined) return <LoadingState variant="cards" />;
  if (gate === null) return <EmptyState icon={ShieldCheckIcon} title="Gate not found" description="This gate is not in the task's history." />;
  return <Report slug={slug} gate={gate} comparison={comparison} detail={detail} />;
}
