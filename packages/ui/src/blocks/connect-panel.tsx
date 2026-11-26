import type { ComponentType, ReactNode } from "react";
import { CheckCircleIcon, CircleNotchIcon } from "@phosphor-icons/react";
import { Card } from "@modelstill/ui/components/card";
import type { StepState } from "@modelstill/ui/lib/steps";
import { cn } from "@modelstill/ui/lib/utils";

type Icon = ComponentType<{ className?: string; weight?: "regular" | "bold" | "fill" | "duotone" }>;

export function ConnectPanel({ children, aside, className }: { children: ReactNode; aside: ReactNode; className?: string }) {
  return (
    <Card data-slot="connect-panel" className={cn("grid gap-0 overflow-hidden rounded-[22px] p-1.5 shadow-[0_1px_2px_rgb(16_16_24/0.04),0_12px_32px_-16px_rgb(16_16_24/0.12)] md:grid-cols-2", className)}>
      <div className="flex min-w-0 flex-col gap-6 px-6 py-7 sm:px-8">{children}</div>
      <div className="min-h-80 overflow-hidden rounded-2xl">{aside}</div>
    </Card>
  );
}

export function ConnectRow({ icon: IconComponent, label, detail, action }: { icon: Icon; label: ReactNode; detail?: ReactNode; action: ReactNode }) {
  return (
    <div data-slot="connect-row" className="flex min-h-(--list-row-h) items-center gap-3 rounded-lg border border-border bg-card py-1.5 pr-1.5 pl-3.5 shadow-[0_1px_1px_rgb(16_16_24/0.03)]">
      <IconComponent weight="duotone" className="size-5 shrink-0 text-brand" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] text-foreground">{label}</span>
        {detail && <span className="block truncate text-[12px] text-muted-foreground">{detail}</span>}
      </span>
      <span className="shrink-0">{action}</span>
    </div>
  );
}

export type SyncStep = { key: string; label: ReactNode; icons?: readonly Icon[]; state: StepState; badge?: ReactNode };

function Pill({ step, final }: { step: SyncStep; final: boolean }) {
  const synced = final && step.state === "done";
  return (
    <div
      data-slot="sync-pill"
      data-state={step.state}
      className={cn(
        "relative flex w-fit max-w-full items-center gap-2.5 rounded-full border bg-card/95 py-1.5 pr-3.5 pl-2 text-[12.5px] shadow-[0_1px_2px_rgb(16_16_24/0.06)] backdrop-blur",
        synced ? "border-brand text-brand-text ring-2 ring-brand/15" : "border-white/70 text-foreground",
        step.state === "upcoming" && "text-muted-foreground",
      )}
    >
      {synced ? (
        <CheckCircleIcon weight="fill" className="size-4 text-brand" />
      ) : step.state === "current" ? (
        <CircleNotchIcon className="size-4 animate-spin text-brand" />
      ) : (
        <span className="flex [&>*+*]:-ml-1">
          {(step.icons ?? []).map((IconComponent, index) => (
            <span key={index} className="grid size-5 place-items-center rounded-full border border-border bg-card text-brand-text">
              <IconComponent weight="bold" className="size-3" />
            </span>
          ))}
        </span>
      )}
      <span className="truncate">{step.label}</span>
      {step.badge && <span className="absolute -top-2 -right-2 rounded-md bg-brand px-1.5 font-mono text-[10.5px] leading-4 text-brand-foreground">{step.badge}</span>}
    </div>
  );
}

export function SyncTimeline({ steps, footer, className }: { steps: readonly SyncStep[]; footer?: ReactNode; className?: string }) {
  return (
    <div data-slot="sync-timeline" className={cn("ms-gradient-mist relative flex h-full flex-col px-8 pt-10", className)}>
      <ol className="relative flex flex-col gap-4">
        <span aria-hidden="true" className="absolute top-4 bottom-4 left-[18px] w-px bg-brand/25" />
        {steps.map((step, index) => (
          <li key={step.key} className="relative">
            <Pill step={step} final={index === steps.length - 1} />
          </li>
        ))}
      </ol>
      {footer && (
        <div className="relative mt-6 ml-[18px] flex-1">
          <span aria-hidden="true" className="absolute -top-6 left-0 h-6 w-px bg-brand/50" />
          <div className="h-full min-h-40 rounded-tl-xl border-t border-l border-brand/50 bg-card/80 p-4">{footer}</div>
        </div>
      )}
    </div>
  );
}
