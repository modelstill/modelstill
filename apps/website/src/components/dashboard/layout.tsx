"use client";

import type { ReactNode } from "react";
import { cn } from "@modelstill/ui/lib/utils";

export function ListPage({ toolbar, children, className }: { toolbar?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div data-slot="list-page" className={cn("flex min-h-0 w-full min-w-0 flex-1 flex-col", className)}>
      {toolbar && (
        <div role="toolbar" data-slot="page-toolbar" className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 px-3 pt-3 pb-2">
          {toolbar}
        </div>
      )}
      <div className={cn("flex min-w-0 flex-1 flex-col gap-4 px-3 pb-3", !toolbar && "pt-3")}>{children}</div>
    </div>
  );
}

export function ToolbarSpacer() {
  return <span aria-hidden="true" className="flex-1" />;
}

export function ToolbarNote({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("text-[12px] text-muted-foreground tabular-nums", className)}>{children}</span>;
}

export function PanelSection({ title, description, actions, children }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex min-h-7 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="type-title text-foreground">{title}</h2>
          {description && <p className="truncate text-[12px] text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-1.5">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function SettingsPage({ children }: { children: ReactNode }) {
  return (
    <div data-slot="settings-page" className="mx-auto flex w-full max-w-[768px] flex-col gap-10 px-6 pt-[52px] pb-16">
      {children}
    </div>
  );
}

export function SettingsSection({ title, description, actions, children }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="type-title text-foreground">{title}</h2>
          {description && <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function SettingsCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("divide-y divide-border rounded-lg border border-border bg-card", className)}>{children}</div>;
}

export function SettingsRow({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
      <div className="min-w-0 max-w-[340px]">
        <div className="text-[12.5px] leading-4 font-medium text-foreground">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] leading-4 text-muted-foreground">{hint}</div>}
      </div>
      <div className="flex min-w-0 items-center justify-end gap-2 text-[13px]">{children}</div>
    </div>
  );
}
