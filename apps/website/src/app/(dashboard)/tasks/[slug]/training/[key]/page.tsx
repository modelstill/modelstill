"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useReducedMotion } from "motion/react";
import {
  BarbellIcon,
  ChartLineIcon,
  CheckSquareOffsetIcon,
  CubeIcon,
  DatabaseIcon,
  FlagCheckeredIcon,
  FlaskIcon,
  PlayIcon,
  ShieldCheckIcon,
  TerminalWindowIcon,
} from "@phosphor-icons/react";
import { ActivityTimeline, type ActivityStep } from "@modelstill/ui/blocks/activity-timeline";
import { ChartCard } from "@modelstill/ui/blocks/chart-card";
import { CodeTabs, CopyField } from "@modelstill/ui/blocks/code-panel";
import { DetailHeader, SectionTitle, SpecTable } from "@modelstill/ui/blocks/detail-header";
import { ModelName } from "@modelstill/ui/blocks/model-name";
import { StepChart } from "@modelstill/ui/blocks/step-chart";
import { Button } from "@modelstill/ui/components/button";
import { TrainStatusBadge } from "@/components/badges";
import { EmptyState, ResourceView } from "@/components/states";
import type { TrainRun, TrainRunDetail, TrainSeries } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { taskSectionHref } from "@/lib/nav";
import { LIVE_REFRESH_MS, formatMetric, latestStep, metricCharts } from "@/lib/training";
import { consoleEvents, exportSnippets, formatDuration, servedSnippets, type ConsoleEvent } from "@/lib/training-console";
import { usePolling, useResource } from "@/lib/use-api";
import { useSlug } from "@/lib/use-slug";

function useRunKey(): string {
  const params = useParams<{ key: string }>();
  return decodeURIComponent(params?.key ?? "");
}

function eventStep(event: ConsoleEvent): ActivityStep {
  if (event.kind === "start") return { key: event.key, icon: PlayIcon, title: "Training started", detail: formatDateTime(String(event.values["startedAt"])), tags: ["start"], json: event.values };
  if (event.kind === "train")
    return {
      key: event.key,
      icon: TerminalWindowIcon,
      title: `Logged train loss, steps ${event.values.firstStep} to ${event.values.lastStep}`,
      detail: `${event.values.points} points`,
      tags: ["train"],
    };
  if (event.kind === "eval")
    return {
      key: event.key,
      icon: FlaskIcon,
      title: `Eval at step ${event.step}`,
      detail: Object.entries(event.values)
        .filter(([name]) => name !== "epoch")
        .map(([name, value]) => `${name} ${formatMetric(value)}`)
        .join(" · "),
      tags: ["eval"],
      json: { step: event.step, ...event.values },
    };
  return { key: event.key, icon: CheckSquareOffsetIcon, title: "Final metrics recorded", tags: ["artifact"], json: event.values };
}

function TrainingConsole({ run, series }: { run: TrainRun; series: TrainSeries }) {
  const events = consoleEvents(run, series);
  const evals = events.filter((event) => event.kind === "eval").length;
  const step = latestStep(series);
  return (
    <ActivityTimeline
      icon={TerminalWindowIcon}
      summary={`${evals} ${evals === 1 ? "eval" : "evals"}, ${step === null ? "no steps" : `${step} steps`} logged, ${run.status}`}
      duration={formatDuration(run.startedAt, run.finishedAt) ?? "running"}
      steps={events.map(eventStep)}
      done={run.status === "succeeded" ? "Done" : run.status === "failed" ? "Failed" : undefined}
    />
  );
}

function RunView({ slug, detail }: { slug: string; detail: TrainRunDetail }) {
  const { run, series } = detail;
  const charts = metricCharts(series);
  const reduced = useReducedMotion() ?? false;
  return (
    <div className="flex flex-col gap-10">
      <DetailHeader
        backHref={taskSectionHref(slug, "training")}
        backLabel="Training runs"
        icon={CubeIcon}
        title={<span className="font-mono text-[19px]">{run.key}</span>}
        badge={<TrainStatusBadge status={run.status} />}
        description={`${run.method} on ${run.base}. The served name is the immutable artifact path.`}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={taskSectionHref(slug, "datasets")}>
                <DatabaseIcon aria-hidden="true" data-icon="inline-start" />
                Training data
              </Link>
            </Button>
            <Button asChild>
              <Link href={taskSectionHref(slug, "gates")}>
                <ShieldCheckIcon aria-hidden="true" data-icon="inline-start" />
                Check the gate
              </Link>
            </Button>
          </>
        }
      >
        <CopyField value={run.key} label="Copy the served name" />
      </DetailHeader>

      <section className="flex flex-col gap-3">
        <SectionTitle>Quickstart</SectionTitle>
        <CodeTabs tabs={servedSnippets(run.key)} />
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle>Export</SectionTitle>
        <CodeTabs tabs={exportSnippets(slug, run.key)} />
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle>Specification</SectionTitle>
        <SpecTable
          rows={[
            { label: "Base", value: <ModelName model={run.base} /> },
            { label: "Method", value: run.method },
            { label: "Started", value: formatDateTime(run.startedAt) },
            { label: "Finished", value: formatDateTime(run.finishedAt) },
            { label: "Duration", value: formatDuration(run.startedAt, run.finishedAt) ?? "still training" },
            ...Object.entries(run.finalMetrics ?? {}).map(([name, value]) => ({ key: name, label: name, value: <span className="font-mono text-[12.5px]">{formatMetric(value)}</span> })),
            ...(run.attestation && typeof run.attestation === "object"
              ? Object.entries(run.attestation as Record<string, unknown>)
                  .filter(([, value]) => typeof value === "string" || typeof value === "number")
                  .map(([name, value]) => ({ key: `attestation-${name}`, label: `attestation ${name}`, value: <span className="font-mono text-[12.5px]">{String(value)}</span> }))
              : []),
          ]}
        />
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle>Training console</SectionTitle>
        <TrainingConsole run={run} series={series} />
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle action={<FlagCheckeredIcon className="size-4 text-muted-foreground" />}>Curves</SectionTitle>
        <div className="grid gap-3 lg:grid-cols-2">
          {charts.map((chart) => (
            <ChartCard key={chart.title} title={chart.title} description={chart.description} value={chart.rows.length > 0 ? formatMetric(chart.latest) : undefined} note="latest">
              {chart.rows.length > 0 ? (
                <StepChart data={chart.rows} series={chart.series} drawIn={!reduced} />
              ) : (
                <EmptyState icon={ChartLineIcon} title="Not logged" description="This run has no points for this metric." className="h-52" />
              )}
            </ChartCard>
          ))}
        </div>
      </section>
    </div>
  );
}

export default function TrainRunPage() {
  const key = useRunKey();
  const slug = useSlug();
  const detail = useResource((api) => api.getTrainRun(key), [key]);
  const live = detail.status === "ready" && detail.data.run.status === "running";
  usePolling(detail.refresh, LIVE_REFRESH_MS, live);

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col px-6 pt-10 pb-16">
      <ResourceView resource={detail} loading="cards" empty="Training run not found.">
        {(data) => <RunView slug={slug} detail={data} />}
      </ResourceView>
      {live && <p className="mt-4 flex items-center gap-1.5 text-[12px] text-muted-foreground"><BarbellIcon className="size-3.5" />Refreshes every {LIVE_REFRESH_MS / 1000} s while training.</p>}
    </div>
  );
}
