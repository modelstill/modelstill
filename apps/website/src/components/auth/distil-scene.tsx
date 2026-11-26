"use client";

import type { ComponentType, ReactNode } from "react";
import { CheckIcon, CircleNotchIcon, CloudIcon, CpuIcon, DropIcon, HourglassIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { cn } from "@modelstill/ui/lib/utils";
import { EXAMPLE_FLOW, type FlowStep, type FlowStepKey } from "@/lib/scene";

const STEP_ICON: Record<FlowStepKey, ComponentType<{ className?: string; weight?: "regular" | "fill" | "bold" }>> = {
  record: CloudIcon,
  distil: DropIcon,
  gate: ShieldCheckIcon,
  serve: CpuIcon,
};

const STATE_LABEL = { done: "done", checking: "checking", waiting: "waits" } as const;

export function ExampleTag({ className }: { className?: string }) {
  return (
    <span
      data-slot="example-tag"
      className={cn("inline-flex h-4 items-center rounded-[3px] bg-brand-wash px-1.5 font-mono text-[10px] leading-none font-medium tracking-[0.08em] text-brand-text uppercase", className)}
    >
      Example
    </span>
  );
}

function StateMark({ state }: { state: FlowStep["state"] }) {
  if (state === "done") return <CheckIcon aria-hidden="true" weight="bold" className="size-3" />;
  if (state === "checking") return <CircleNotchIcon aria-hidden="true" weight="bold" className="ms-spin size-3" />;
  return <HourglassIcon aria-hidden="true" className="size-3" />;
}

function StepNode({ step }: { step: FlowStep }) {
  const Icon = STEP_ICON[step.key];
  return (
    <li data-step={step.key} data-state={step.state} className="flex w-16 flex-col items-center gap-2 text-center">
      <span
        className={cn(
          "relative z-10 grid size-11 place-items-center rounded-full border bg-card",
          step.state === "checking" ? "border-primary text-primary shadow-[0_0_0_4px_var(--brand-wash)]" : "border-border",
          step.state === "done" && "text-foreground",
          step.state === "waiting" && "text-muted-foreground",
        )}
      >
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <span className="text-[12.5px] leading-4 font-medium text-foreground">{step.label}</span>
      <span className="inline-flex items-center gap-1 text-[11px] leading-3 text-muted-foreground">
        <StateMark state={step.state} />
        {STATE_LABEL[step.state]}
      </span>
    </li>
  );
}

function Connectors({ steps }: { steps: readonly FlowStep[] }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-8 top-[21px] flex">
      {steps.slice(1).map((to) => (
        <span key={to.key} data-slot="flow-connector" data-state={to.state} className="flow-connector h-0.5 flex-1" />
      ))}
    </div>
  );
}

export function FloatingCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("relative mx-auto w-full", className)}>
      <ExampleTag className="absolute -top-2 right-4 z-20" />
      <div className="rounded-xl border border-border bg-card text-foreground shadow-[0_24px_64px_-28px_rgba(14,116,144,0.45)]">{children}</div>
    </div>
  );
}

export function DistilScene() {
  return (
    <FloatingCard className="max-w-[440px]">
      <div data-slot="distil-scene" className="p-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[14px] font-medium text-foreground">How one task ships</p>
          <p className="font-mono text-[12px] text-muted-foreground">tasks/your-task</p>
        </div>
        <div className="relative mt-5">
          <Connectors steps={EXAMPLE_FLOW} />
          <ol aria-label="Example flow" className="relative flex items-start justify-between">
            {EXAMPLE_FLOW.map((step) => (
              <StepNode key={step.key} step={step} />
            ))}
          </ol>
        </div>
        <p className="mt-5 flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-[12.5px] leading-[18px] text-muted-foreground">
          <CircleNotchIcon aria-hidden="true" weight="bold" className="ms-spin mt-0.5 size-3.5 shrink-0" />
          <span>
            The gate scores the small model against the cloud model on your golden set. It serves only if the gate passes.
          </span>
        </p>
      </div>
    </FloatingCard>
  );
}
