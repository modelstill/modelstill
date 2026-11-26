/*
 * Adapted from Helicone, web/components/templates/requests/statusBadge.tsx
 * Copyright 2023 Helicone Inc. Licensed under the Apache License, Version 2.0 (see LICENSE in this folder).
 * Modified for ModelStill: generic tones instead of request statuses, re-styled with this app's semantic tokens (success, warning, destructive, primary, muted).
 */
import type { ReactNode } from "react";
import { cn } from "@modelstill/ui/lib/utils";

export type StatusTone = "ok" | "fail" | "warn" | "run" | "idle";

const toneClass: Record<StatusTone, string> = {
  ok: "bg-success/12 text-success ring-success/20",
  fail: "bg-destructive/10 text-destructive ring-destructive/20",
  warn: "bg-warning/14 text-warning ring-warning/20",
  run: "bg-primary/10 text-primary ring-primary/20",
  idle: "bg-muted text-muted-foreground ring-border",
};

export function StatusBadge({ tone, children, className }: { tone: StatusTone; children: ReactNode; className?: string }) {
  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex h-5 items-center gap-1.5 rounded-sm px-1.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        toneClass[tone],
        className,
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}
