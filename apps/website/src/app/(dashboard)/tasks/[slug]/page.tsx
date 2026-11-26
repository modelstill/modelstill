"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRightIcon, GearSixIcon, StackIcon } from "@phosphor-icons/react";
import { CopyField } from "@modelstill/ui/blocks/code-panel";
import { DetailHeader } from "@modelstill/ui/blocks/detail-header";
import { GateChecks } from "@modelstill/ui/blocks/gate-checks";
import { Button } from "@modelstill/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@modelstill/ui/components/card";
import { cn } from "@modelstill/ui/lib/utils";
import { ModeBadge, PassBadge } from "@/components/badges";
import { HeaderLink } from "@/components/dashboard/header-link";
import { ListPage, PanelSection } from "@/components/dashboard/layout";
import { SECTION_ICONS } from "@/components/dashboard/section-icons";
import { ErrorState, ResourceView } from "@/components/states";
import { TaskWidgets } from "@/components/overview/task-widgets";
import { TaskEmptyState } from "@/components/task-empty";
import { TrainRunsTable } from "@/components/training/train-runs-table";
import { emptyPage } from "@/lib/empty-states";
import { labelledCount, nextStep, type FlowState } from "@/lib/flow";
import { formatDateTime } from "@/lib/format";
import { formatShare } from "@/lib/interval";
import { taskNavGroups, taskSectionHref, taskSettingsHref, type TaskSectionKey } from "@/lib/nav";
import { useResource } from "@/lib/use-api";
import { useSlug } from "@/lib/use-slug";

const STEP_COPY: Record<TaskSectionKey, string> = {
  overview: "",
  traffic: "Watch who answers: the student or the cloud.",
  monitoring: "Run canaries and look at open alerts.",
  evals: "Record an eval run, then compare two runs case by case.",
  review: "Settle the cases where the answers disagree.",
  datasets: "Check the labelled rows before training.",
  gates: "Gate the trained student against the baseline.",
  training: "Train a student on the labelled rows.",
  deployment: "Serve the student behind the gateway.",
};

function StageLink({ slug, section, label, status, highlight }: { slug: string; section: TaskSectionKey; label: string; status: ReactNode; highlight: boolean }) {
  const Icon = SECTION_ICONS[section];
  return (
    <Link
      href={taskSectionHref(slug, section)}
      className={cn(
        "group flex items-start gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-muted",
        highlight && "bg-brand-wash hover:bg-brand-wash",
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground", highlight && "text-brand-text")} />
      <span className="min-w-0 flex-1">
        <span className={cn("block text-[13px] font-medium text-foreground", highlight && "text-brand-text")}>{label}</span>
        <span className="block truncate text-[12px] text-muted-foreground">{status}</span>
      </span>
      {highlight && <ArrowRightIcon aria-hidden="true" className="mt-0.5 size-3.5 text-brand-text" />}
    </Link>
  );
}

export default function TaskOverviewPage() {
  const slug = useSlug();
  const task = useResource((api) => api.getTask(slug), [slug]);
  const deployment = useResource((api) => api.getDeployment(slug), [slug]);
  const gates = useResource((api) => api.listGates(slug), [slug]);
  const trainRuns = useResource((api) => api.listTrainRuns(slug), [slug]);
  const evalRuns = useResource((api) => api.listEvalRuns(slug), [slug]);
  const queue = useResource((api) => api.listReviewQueue(slug), [slug]);
  const dataset = useResource((api) => api.listDatasetItems(slug), [slug]);
  const alerts = useResource((api) => api.listAlerts(slug), [slug]);

  const count = <T,>(resource: { status: string; data?: T[] }) => (resource.status === "ready" ? (resource.data?.length ?? 0) : null);
  const state: FlowState | null =
    task.status === "ready"
      ? {
          evalRuns: count(evalRuns) ?? 0,
          pendingReview: count(queue) ?? 0,
          labelled: dataset.status === "ready" ? labelledCount(dataset.data) : 0,
          trainRuns: count(trainRuns) ?? 0,
          lastGatePassed: task.data.lastGatePassed,
          mode: task.data.mode,
        }
      : null;
  const next = state ? nextStep(state) : null;
  const openAlerts = alerts.status === "ready" ? alerts.data.filter((alert) => !alert.ackedAt).length : null;

  const statusOf: Record<TaskSectionKey, ReactNode> = {
    overview: "",
    traffic: task.status === "ready" ? `deferral share ${formatShare(task.data.deferralShare)}` : "...",
    monitoring: openAlerts === null ? "..." : openAlerts === 0 ? "no open alerts" : `${openAlerts} open ${openAlerts === 1 ? "alert" : "alerts"}`,
    evals: count(evalRuns) === null ? "..." : `${count(evalRuns)} runs`,
    review: count(queue) === null ? "..." : `${count(queue)} waiting`,
    datasets: dataset.status === "ready" ? `${labelledCount(dataset.data)} labelled of ${dataset.data.length}` : "...",
    gates: task.status === "ready" ? (task.data.lastGatePassed === null ? "no gate yet" : task.data.lastGatePassed ? "last gate passed" : "last gate failed") : "...",
    training: count(trainRuns) === null ? "..." : `${count(trainRuns)} runs`,
    deployment: task.status === "ready" ? `mode ${task.data.mode}` : "...",
  };

  return (
    <ListPage>
      {task.status === "error" && <ErrorState error={task.error} onRetry={task.reload} />}

      <div className="px-1 pt-3">
        <DetailHeader
          backHref="/tasks"
          backLabel="All tasks"
          icon={StackIcon}
          title={<span className="font-mono">{slug}</span>}
          badge={task.status === "ready" ? <ModeBadge mode={task.data.mode} /> : undefined}
          description={task.status === "ready" ? `Version ${task.data.version}. ${next ? STEP_COPY[next] : ""}` : "Loading the task..."}
          actions={
            <>
              <Button asChild variant="outline" size="sm">
                <Link href={taskSettingsHref(slug)}>
                  <GearSixIcon aria-hidden="true" data-icon="inline-start" />
                  Settings
                </Link>
              </Button>
              {next && (
                <Button asChild size="sm">
                  <Link href={taskSectionHref(slug, next)}>
                    Open {taskNavGroups(slug).flatMap((group) => group.items).find((item) => item.key === next)!.label.toLowerCase()}
                    <ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
                  </Link>
                </Button>
              )}
            </>
          }
        >
          {task.status === "ready" && (
            <div className="max-w-xl">
              <CopyField value={task.data.snapshotHash} label="Copy the snapshot hash" />
            </div>
          )}
        </DetailHeader>
      </div>

      <TaskWidgets slug={slug} />

      <div className="grid gap-4 md:grid-cols-3">
        {taskNavGroups(slug)
          .filter((group) => group.label)
          .map((group) => (
            <section key={group.label} aria-label={group.label!} className="flex flex-col gap-1">
              <h2 className="px-2 type-label">{group.label}</h2>
              {group.items.map((item) => (
                <StageLink key={item.key} slug={slug} section={item.key} label={item.label} status={statusOf[item.key]} highlight={item.key === next} />
              ))}
            </section>
          ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <PanelSection
          title="Latest gate"
          actions={
            <HeaderLink href={taskSectionHref(slug, "gates")} icon={ArrowRightIcon}>
              Gate history
            </HeaderLink>
          }
        >
          <ResourceView resource={gates} empty="No gate has run for this task yet." emptyState={<TaskEmptyState page={emptyPage("gates", slug)} className="py-2" />}>
            {(rows) => {
              const latest = [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!;
              return (
                <Card className="gap-0 py-0">
                  <CardHeader className="border-b px-4 py-2.5 [.border-b]:pb-2.5">
                    <CardTitle className="flex items-center gap-2 text-[13px]">
                      <PassBadge passed={latest.passed} />
                      <span className="font-normal text-muted-foreground">{formatDateTime(latest.createdAt)}</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-0">
                    <GateChecks checks={latest.checks} />
                  </CardContent>
                </Card>
              );
            }}
          </ResourceView>
        </PanelSection>

        <PanelSection
          title="Training runs"
          actions={
            <HeaderLink href={taskSectionHref(slug, "training")} icon={ArrowRightIcon}>
              All training runs
            </HeaderLink>
          }
        >
          <ResourceView resource={trainRuns} empty="No training runs recorded yet." emptyState={<TaskEmptyState page={emptyPage("training", slug)} className="py-2" />}>
            {(rows) => <TrainRunsTable slug={slug} runs={rows.slice(0, 5)} />}
          </ResourceView>
        </PanelSection>
      </div>

      {deployment.status === "ready" && deployment.data === null && (
        <p className="px-1 text-[12px] text-muted-foreground">
          This task is not deployed yet.{" "}
          <Link href={taskSectionHref(slug, "deployment")} className="text-primary hover:underline">
            How to deploy it
          </Link>
        </p>
      )}
    </ListPage>
  );
}
