"use client";

import { ArrowRightIcon, ClockCounterClockwiseIcon, FileCodeIcon, PlugsConnectedIcon, StackIcon } from "@phosphor-icons/react";
import { ConnectPanel, ConnectRow, SyncTimeline } from "@modelstill/ui/blocks/connect-panel";
import { Button } from "@modelstill/ui/components/button";
import { Skeleton } from "@modelstill/ui/components/skeleton";
import { dataSync, type DataSyncKey } from "@/lib/get-started";
import { DOCS_URL } from "@/lib/links";
import { onboardingStep } from "@/lib/onboarding";
import { useResource } from "@/lib/use-api";
import { OnboardingHeader } from "./onboarding-split";

const SYNC_ICONS: Record<DataSyncKey, typeof PlugsConnectedIcon[]> = {
  gateway: [PlugsConnectedIcon],
  task: [FileCodeIcon],
  history: [ClockCounterClockwiseIcon],
  synced: [],
};

function ConnectButton({ href, label, external }: { href: string; label: string; external?: boolean }) {
  return (
    <Button asChild variant="outline" size="sm" className="h-8 px-3 text-[13px]">
      <a href={href} aria-label={label} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>
        Connect
      </a>
    </Button>
  );
}

export function DataStep({ navigate }: { navigate: (href: string) => void }) {
  const step = onboardingStep("data");
  const tasks = useResource((api) => api.listTasks(), ["onboarding-tasks"]);
  const first = tasks.status === "ready" ? tasks.data[0]?.slug : undefined;
  const runs = useResource((api) => (first ? api.listEvalRuns(first) : Promise.resolve([])), [first ?? "", "onboarding-runs"]);
  const sync =
    tasks.status === "ready" && runs.status === "ready" ? dataSync({ tasks: tasks.data, evalRuns: runs.data.length }) : null;

  return (
    <main className="flex min-h-screen flex-col bg-sidebar px-4 py-6 text-foreground sm:px-10">
      <div className="mx-auto w-full max-w-[1080px]">
        <OnboardingHeader step={step.number} total={step.total} />
      </div>
      <div className="flex flex-1 items-center justify-center py-10">
        <ConnectPanel
          className="w-full max-w-[1080px]"
          aside={
            sync ? (
              <SyncTimeline
                steps={sync.map((entry) => ({ key: entry.key, label: entry.label, state: entry.state, icons: SYNC_ICONS[entry.key] }))}
                footer={
                  <div className="flex flex-col gap-2.5">
                    <span className="flex items-center gap-2 text-[13px] font-medium">
                      <StackIcon className="size-4 text-brand" />
                      {first ?? "Your first task"}
                    </span>
                    {(tasks.status === "ready" ? tasks.data : []).slice(0, 4).map((task) => (
                      <span key={task.slug} className="flex items-center gap-2 font-mono text-[11.5px] text-muted-foreground">
                        <span className="size-1.5 rounded-full bg-brand/50" />
                        {task.slug} · {task.mode}
                      </span>
                    ))}
                  </div>
                }
              />
            ) : (
              <Skeleton className="h-full min-h-80 w-full" />
            )
          }
        >
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[20px] leading-7 font-medium text-foreground">Bring in your data</h1>
            <p className="max-w-[420px] text-[14px] leading-6 text-muted-foreground">
              The gateway logs every call, the spec defines the task, and past calls become the first eval set. Each one you connect gives the student more to learn from.
            </p>
          </div>
          <div className="flex flex-col gap-2.5">
            <ConnectRow icon={PlugsConnectedIcon} label="LiteLLM gateway" detail="Logs both answers on every call" action={<ConnectButton href={DOCS_URL} label="Connect LiteLLM" external />} />
            <ConnectRow icon={FileCodeIcon} label="Push a task" detail="modelstill push task spec.yaml" action={<ConnectButton href={onboardingStep("task").href} label="Push a task" />} />
            <ConnectRow
              icon={ClockCounterClockwiseIcon}
              label="Import history"
              detail="modelstill push run history.jsonl"
              action={<ConnectButton href={DOCS_URL} label="Import history" external />}
            />
          </div>
          <div className="mt-auto flex items-center justify-between gap-3 pt-6">
            <Button type="button" variant="link" onClick={() => navigate(step.next)} className="h-auto p-0 text-[13.5px] text-foreground hover:no-underline">
              Skip this step
            </Button>
            <Button type="button" onClick={() => navigate(step.next)}>
              Continue
              <ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
            </Button>
          </div>
        </ConnectPanel>
      </div>
    </main>
  );
}
