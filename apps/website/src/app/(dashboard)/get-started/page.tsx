"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckIcon,
  ClockCounterClockwiseIcon,
  DatabaseIcon,
  FileCodeIcon,
  ListChecksIcon,
  PlayIcon,
  PlugsConnectedIcon,
  RocketLaunchIcon,
  ShieldCheckIcon,
  UserCheckIcon,
} from "@phosphor-icons/react";
import { FeatureRow, TileChip, TileIcon } from "@modelstill/ui/blocks/feature-row";
import { ProgressRing } from "@modelstill/ui/blocks/progress-ring";
import { ReportHeader } from "@modelstill/ui/blocks/report";
import { Badge } from "@modelstill/ui/components/badge";
import { Button } from "@modelstill/ui/components/button";
import { progressOf } from "@modelstill/ui/lib/steps";
import { SetupIntroDialog } from "@/components/dashboard/setup-intro";
import { setupSteps, type SetupKey } from "@/lib/get-started";
import { onboardingStep } from "@/lib/onboarding";
import { taskHref, taskSectionHref } from "@/lib/nav";
import { useResource } from "@/lib/use-api";
import { reviewProgress } from "@/lib/widgets";

function Status({ done }: { done: boolean | null }) {
  if (done === null) return null;
  return done ? (
    <Badge variant="success">
      <CheckIcon aria-hidden="true" weight="bold" />
      Done
    </Badge>
  ) : (
    <Badge variant="outline">To do</Badge>
  );
}

export default function GetStartedPage() {
  const router = useRouter();
  const [intro, setIntro] = useState(false);
  const tasks = useResource((api) => api.listTasks(), ["get-started-tasks"]);
  const list = tasks.status === "ready" ? tasks.data : null;
  const first = list?.[0]?.slug ?? null;
  const queue = useResource((api) => (first ? api.listReviewQueue(first) : Promise.resolve([])), [first ?? "", "get-started-queue"]);
  const steps = setupSteps(list);
  const progress = progressOf(steps.map((step) => step.done));
  const done = (key: SetupKey) => (list === null ? null : steps.find((step) => step.key === key)!.done);
  const reviewed = queue.status === "ready" ? reviewProgress(queue.data) : null;

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-8 px-6 pt-14 pb-16">
      <ReportHeader
        title="Get started"
        meta={
          <span className="flex flex-wrap items-center gap-2.5">
            <ProgressRing value={progress.fraction} size={16} label="Setup progress" />
            {progress.done} of {progress.total} setup steps done
            <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => setIntro(true)}>
              <PlayIcon aria-hidden="true" data-icon="inline-start" />
              Watch the setup
            </Button>
          </span>
        }
      />
      <div className="flex flex-col gap-5">
        <FeatureRow
          gradient="aurora"
          href={first ? taskHref(first) : onboardingStep("task").href}
          title="Define a task"
          description="One spec with the prompt you run today and what a right answer is."
          status={<Status done={done("task")} />}
          tile={
            <>
              <TileChip icon={FileCodeIcon}>spec.yaml</TileChip>
              <TileChip icon={ShieldCheckIcon} offset={18}>
                gate thresholds
              </TileChip>
              <TileChip icon={PlayIcon} offset={36}>
                push task
              </TileChip>
            </>
          }
        />
        <FeatureRow
          gradient="tide"
          href={first ? taskSectionHref(first, "traffic") : onboardingStep("data").href}
          title="Import production history"
          description="Record calls through the gateway, or push past calls as an eval run."
          status={<Status done={done("traffic")} />}
          tile={
            <span className="flex items-center gap-2.5">
              <TileIcon icon={PlugsConnectedIcon} />
              <TileIcon icon={ClockCounterClockwiseIcon} />
              <TileIcon icon={DatabaseIcon} />
            </span>
          }
        />
        <FeatureRow
          gradient="dawn"
          href={first ? taskSectionHref(first, "review") : undefined}
          title="Review cases"
          description="Settle the cases where the answers disagree before training on them."
          status={<Status done={reviewed === null || first === null ? null : reviewed.total > 0 && reviewed.decided === reviewed.total} />}
          tile={
            <>
              <TileChip icon={ListChecksIcon}>answers differ</TileChip>
              <TileChip icon={UserCheckIcon} offset={14}>
                accept or correct
              </TileChip>
              <TileChip icon={DatabaseIcon} offset={28}>
                labelled row
              </TileChip>
            </>
          }
        />
        <FeatureRow
          gradient="mist"
          href={first ? taskSectionHref(first, "gates") : undefined}
          title="Gate and serve the student"
          description="Ship the small model only when the gate says so, then let the gateway serve it."
          status={<Status done={done("serve")} />}
          tile={
            <>
              <TileChip icon={ShieldCheckIcon}>gate passed</TileChip>
              <TileChip icon={RocketLaunchIcon} offset={18}>
                shadow to serve
              </TileChip>
            </>
          }
        />
      </div>
      <SetupIntroDialog
        open={intro}
        onOpenChange={setIntro}
        onExplore={() => {
          setIntro(false);
          router.push(first ? taskHref(first) : onboardingStep("task").href);
        }}
      />
    </div>
  );
}
