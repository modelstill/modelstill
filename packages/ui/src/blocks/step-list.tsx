import type { ReactNode } from "react";
import { CheckCircleIcon, CircleDashedIcon, CircleIcon } from "@phosphor-icons/react";
import type { StepState } from "@modelstill/ui/lib/steps";
import { cn } from "@modelstill/ui/lib/utils";

export type StepItem = { key: string; label: ReactNode; state: StepState };

function StepMark({ state }: { state: StepState }) {
  if (state === "done") return <CheckCircleIcon aria-hidden="true" weight="fill" className="size-4 text-foreground" />;
  if (state === "current")
    return (
      <span aria-hidden="true" className="grid size-4 place-items-center rounded-full bg-brand">
        <CircleIcon weight="fill" className="size-1.5 text-brand-foreground" />
      </span>
    );
  return <CircleDashedIcon aria-hidden="true" className="size-4 text-muted-foreground" />;
}

export function StepList({ steps, onSelect, className }: { steps: readonly StepItem[]; onSelect?: (key: string) => void; className?: string }) {
  return (
    <ol data-slot="step-list" className={cn("flex flex-col gap-0.5", className)}>
      {steps.map((step) => {
        const clickable = Boolean(onSelect) && step.state === "done";
        return (
          <li key={step.key}>
            <button
              type="button"
              disabled={!clickable}
              aria-current={step.state === "current" ? "step" : undefined}
              data-state={step.state}
              onClick={() => onSelect?.(step.key)}
              className={cn(
                "flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] transition-colors disabled:cursor-default",
                step.state === "current" && "bg-muted font-medium text-foreground",
                step.state === "done" && "text-foreground hover:bg-muted/60",
                step.state === "upcoming" && "text-muted-foreground",
              )}
            >
              <StepMark state={step.state} />
              {step.label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
