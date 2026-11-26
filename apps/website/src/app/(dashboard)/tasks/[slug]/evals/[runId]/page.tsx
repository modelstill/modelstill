"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeftIcon, ArrowRightIcon, ArrowsLeftRightIcon, CheckCircleIcon, FlaskIcon } from "@phosphor-icons/react";
import { CodeId } from "@modelstill/ui/blocks/code-id";
import { ModelName } from "@modelstill/ui/blocks/model-name";
import { PageHeader } from "@modelstill/ui/blocks/page-header";
import { Section } from "@modelstill/ui/blocks/section";
import { StatCard } from "@modelstill/ui/blocks/stat-card";
import { ToolbarText } from "@modelstill/ui/blocks/toolbar";
import { Badge } from "@modelstill/ui/components/badge";
import { Button } from "@modelstill/ui/components/button";
import { HeaderLink } from "@/components/dashboard/header-link";
import { PageActions } from "@/components/dashboard/page-actions";
import { PageBody } from "@/components/dashboard/shell";
import { MetricHistogram } from "@/components/evals/metric-histogram";
import { RunCasesTable } from "@/components/evals/run-cases-table";
import { ResourceView } from "@/components/states";
import type { EvalRunDetail } from "@/lib/api";
import { formatDateTime, metricLabel } from "@/lib/format";
import { compareHref, taskSectionHref } from "@/lib/nav";
import { CASE_PAGE_SIZE, baselineFor, pageLabel } from "@/lib/run-detail";
import { useResource } from "@/lib/use-api";
import { useSlug } from "@/lib/use-slug";

function useRunId(): string {
  const params = useParams<{ runId: string }>();
  return decodeURIComponent(params?.runId ?? "");
}

function Summary({ detail }: { detail: EvalRunDetail }) {
  const { run } = detail;
  const named = Object.entries(run.metrics).filter(([name]) => name !== run.primaryMetric);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        label={`Score, ${metricLabel(run.primaryMetric)}`}
        value={run.mean.toFixed(3)}
        interval={{ low: run.low, high: run.high, digits: 3 }}
        sublabel={run.primaryMetric ? "primary metric, 95% interval" : "case mean, 95% interval"}
      />
      <StatCard label="Cases" value={run.cases} sublabel={`scored on ${run.split}`} />
      {named.slice(0, 2).map(([name, metric]) => (
        <StatCard
          key={name}
          label={metricLabel(name)}
          value={metric.value.toFixed(3)}
          interval={{ low: metric.low, high: metric.high, digits: 3 }}
        />
      ))}
    </div>
  );
}

function Distributions({ detail }: { detail: EvalRunDetail }) {
  if (detail.histograms.length === 0) return null;
  return (
    <Section title="Distributions" description="how the cases spread over each metric">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {detail.histograms.map((entry) => (
          <MetricHistogram key={entry.metric} metric={entry.metric} bins={entry.bins} />
        ))}
      </div>
    </Section>
  );
}

function Cases({ runId, total }: { runId: string; total: number }) {
  const [offset, setOffset] = useState(0);
  const page = useResource((api) => api.listEvalCases(runId, { offset, limit: CASE_PAGE_SIZE }), [runId, offset]);
  const shown = page.status === "ready" ? page.data.cases.length : 0;
  const pager = (
    <>
      <ToolbarText>lowest score first; pick a case for its full detail</ToolbarText>
      <div className="ml-auto flex items-center gap-2">
        <ToolbarText>{pageLabel(offset, shown, total)}</ToolbarText>
        <Button type="button" variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - CASE_PAGE_SIZE))}>
          <ArrowLeftIcon aria-hidden="true" data-icon="inline-start" />
          Previous
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={offset + CASE_PAGE_SIZE >= total} onClick={() => setOffset(offset + CASE_PAGE_SIZE)}>
          Next
          <ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
        </Button>
      </div>
    </>
  );
  return (
    <Section title="Cases" description="every case with its input, output, expected answer and scores">
      <ResourceView resource={page} empty="This run has no cases." isEmptyData={() => false}>
        {(data) => <RunCasesTable cases={data.cases} toolbar={pager} />}
      </ResourceView>
    </Section>
  );
}

function RunView({ runId, detail }: { runId: string; detail: EvalRunDetail }) {
  return (
    <>
      <Summary detail={detail} />
      <Distributions detail={detail} />
      <Cases runId={runId} total={detail.run.cases} />
    </>
  );
}

function CompareWithBaseline({ slug, runId }: { slug: string; runId: string }) {
  const runs = useResource((api) => api.listEvalRuns(slug), [slug]);
  const baseline = runs.status === "ready" ? baselineFor(runs.data, runId) : null;
  if (!baseline) return null;
  return (
    <HeaderLink href={compareHref(slug, baseline.id, runId)} icon={ArrowsLeftRightIcon} primary>
      Compare with the previous run
    </HeaderLink>
  );
}

export default function EvalRunPage() {
  const runId = useRunId();
  const slug = useSlug();
  const detail = useResource((api) => api.getEvalRun(runId), [runId]);
  const run = detail.status === "ready" ? detail.data.run : null;

  return (
    <PageBody className="max-w-none gap-5 py-5 sm:px-5 sm:py-5">
      <PageActions>
        <HeaderLink href={taskSectionHref(slug, "evals")} icon={FlaskIcon}>
          Eval runs
        </HeaderLink>
        <CompareWithBaseline slug={slug} runId={runId} />
      </PageActions>
      <PageHeader
        title={run ? <ModelName model={run.model} /> : "Eval run"}
        description="One eval run: each case with its scores, and how the scores spread."
        meta={
          run ? (
            <>
              <Badge variant="secondary" title="A run is pushed whole, with every case scored">
                <CheckCircleIcon aria-hidden="true" data-icon="inline-start" />
                complete
              </Badge>
              <span>{formatDateTime(run.createdAt)}</span>
              <span>split {run.split}</span>
              {run.benchmark && (
                <span>
                  {run.benchmark.name}@{run.benchmark.version}
                </span>
              )}
              <CodeId value={run.id} />
            </>
          ) : undefined
        }
      />
      <ResourceView resource={detail} loading="cards" empty="Eval run not found.">
        {(data) => <RunView runId={runId} detail={data} />}
      </ResourceView>
    </PageBody>
  );
}
