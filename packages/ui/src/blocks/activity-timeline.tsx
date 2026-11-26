"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import { CaretDownIcon, CheckCircleIcon } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@modelstill/ui/components/collapsible";
import { cn } from "@modelstill/ui/lib/utils";
import { CopyIconButton, HighlightedCode } from "./code-panel";

type Icon = ComponentType<{ className?: string; weight?: "regular" | "bold" | "fill" | "duotone" }>;

export type ActivityStep = {
  key: string;
  icon: Icon;
  title: ReactNode;
  detail?: ReactNode;
  tags?: readonly string[];
  json?: unknown;
};

function JsonBlock({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 2);
  return (
    <div data-slot="activity-json" className="relative rounded-2xl border border-border bg-surface-head px-4 py-3 shadow-[0_1px_2px_rgb(16_16_24/0.04)]">
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-muted-foreground">JSON</span>
        <CopyIconButton value={text} label="Copy JSON" />
      </div>
      <HighlightedCode code={text} className="max-h-72 overflow-y-auto" />
    </div>
  );
}

function StepRow({ step, last }: { step: ActivityStep; last: boolean }) {
  const [open, setOpen] = useState(false);
  const IconComponent = step.icon;
  const expandable = step.json !== undefined;
  const head = (
    <span className="flex min-h-9 w-full items-center gap-3 text-left">
      <IconComponent className="size-[18px] shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] text-foreground">{step.title}</span>
        {step.detail && <span className="block truncate font-mono text-[11.5px] text-muted-foreground">{step.detail}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {step.tags?.map((tag) => (
          <span key={tag} className="rounded-md bg-muted px-2 py-0.5 font-mono text-[11.5px] text-muted-foreground">
            {tag}
          </span>
        ))}
        {expandable && <CaretDownIcon aria-hidden="true" className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />}
      </span>
    </span>
  );
  return (
    <li data-slot="activity-step" className="relative flex flex-col pb-2">
      {!last && <span aria-hidden="true" className="absolute top-8 bottom-0 left-[8.5px] w-px bg-border" />}
      {expandable ? (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger className="w-full rounded-md focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none">{head}</CollapsibleTrigger>
          <CollapsibleContent className="relative z-10 pt-1.5">
            <JsonBlock value={step.json} />
          </CollapsibleContent>
        </Collapsible>
      ) : (
        head
      )}
    </li>
  );
}

export type ActivityTimelineProps = {
  icon: Icon;
  summary: ReactNode;
  duration?: ReactNode;
  steps: readonly ActivityStep[];
  done?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
};

export function ActivityTimeline({ icon: IconComponent, summary, duration, steps, done, defaultOpen = true, className }: ActivityTimelineProps) {
  const [open, setOpen] = useState(defaultOpen);
  const reduced = useReducedMotion() ?? false;
  return (
    <Collapsible open={open} onOpenChange={setOpen} data-slot="activity-timeline" className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center gap-3">
        <IconComponent weight="bold" className="size-5 shrink-0 text-foreground" />
        <CollapsibleTrigger className="group flex min-w-0 items-center gap-2 rounded-md text-left focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none">
          <span className="truncate text-[15px] text-foreground">{summary}</span>
          <CaretDownIcon aria-hidden="true" className={cn("size-4 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")} />
        </CollapsibleTrigger>
        {duration && <span className="ml-auto shrink-0 font-mono text-[13px] text-muted-foreground tabular-nums">{duration}</span>}
      </div>
      <CollapsibleContent forceMount hidden={!open}>
        <motion.ol
          initial={reduced ? false : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
          className="flex flex-col pt-1"
        >
          {steps.map((step, index) => (
            <StepRow key={step.key} step={step} last={index === steps.length - 1 && !done} />
          ))}
          {done && (
            <li className="flex min-h-9 items-center gap-3">
              <CheckCircleIcon className="size-[18px] text-muted-foreground" />
              <span className="text-[14px] text-foreground">{done}</span>
            </li>
          )}
        </motion.ol>
      </CollapsibleContent>
    </Collapsible>
  );
}
