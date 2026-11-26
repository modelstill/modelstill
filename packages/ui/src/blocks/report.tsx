"use client";

import type { ComponentType, ReactNode } from "react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@modelstill/ui/components/card";
import { Separator } from "@modelstill/ui/components/separator";
import { meterRatio } from "@modelstill/ui/lib/meter";
import { cn } from "@modelstill/ui/lib/utils";
import { UiLink } from "./link";

type Icon = ComponentType<{ className?: string; weight?: "regular" | "duotone" | "fill" | "bold" }>;

export function ReportHeader({ title, meta }: { title: ReactNode; meta?: ReactNode }) {
  return (
    <header data-slot="report-header" className="flex flex-col gap-2.5">
      <h1 className="type-title text-foreground">{title}</h1>
      {meta && <p className="text-[13.5px] text-muted-foreground">{meta}</p>}
      <Separator className="mt-5" />
    </header>
  );
}

export function ReportSection({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section data-slot="report-section" className="flex flex-col gap-3.5">
      <h2 className="type-title text-foreground">{title}</h2>
      {children}
    </section>
  );
}

export function Highlights({ children }: { children: ReactNode }) {
  return <ul className="flex list-disc flex-col gap-2.5 pl-5 text-[14px] leading-6 text-foreground marker:text-muted-foreground">{children}</ul>;
}

export function HighlightItem({ children, note }: { children: ReactNode; note?: number }) {
  return (
    <li className="pl-1">
      {children}
      {note !== undefined && <Footnote n={note} />}
    </li>
  );
}

export function Footnote({ n, href }: { n: number; href?: string }) {
  const chip = (
    <span className="ml-1.5 inline-grid h-5 min-w-5 place-items-center rounded-[5px] border border-border bg-surface-head px-1 align-[1px] font-mono text-[11px] leading-none text-muted-foreground tabular-nums">
      {n}
    </span>
  );
  return href ? (
    <UiLink href={href} aria-label={`Source ${n}`}>
      {chip}
    </UiLink>
  ) : (
    <sup className="top-0">{chip}</sup>
  );
}

export function EntityChip({ icon: IconComponent, children, href, mono }: { icon?: Icon; children: ReactNode; href?: string; mono?: boolean }) {
  const body = (
    <span className={cn("inline-flex items-center gap-1 border-b border-border pb-px align-baseline transition-colors", href && "hover:border-foreground")}>
      {IconComponent && (
        <span aria-hidden="true" className="inline-grid size-[18px] place-items-center rounded-[5px] bg-brand-wash text-brand-text [&_svg]:size-3">
          <IconComponent weight="bold" />
        </span>
      )}
      <span className={cn(mono && "font-mono text-[12.5px]")}>{children}</span>
    </span>
  );
  return href ? <UiLink href={href}>{body}</UiLink> : body;
}

export function DenseBars({ values, className }: { values: readonly number[]; className?: string }) {
  const max = Math.max(0, ...values);
  return (
    <div data-slot="dense-bars" className={cn("flex h-14 items-end gap-[2px]", className)}>
      {values.map((value, index) => (
        <span key={index} className="flex-1 rounded-t-[1.5px] bg-chart-3" style={{ height: `${value > 0 ? Math.max(6, meterRatio(value, max) * 100) : 2}%` }} />
      ))}
    </div>
  );
}

export function InsightCard({ icon: IconComponent, label, value, delta, children }: { icon?: Icon; label: ReactNode; value: ReactNode; delta?: ReactNode; children?: ReactNode }) {
  return (
    <Card data-slot="insight-card" className="gap-3 rounded-xl py-4 shadow-none">
      <CardHeader className="gap-2 px-4">
        <CardTitle className="flex items-center gap-2 text-[13px]">
          {IconComponent && <IconComponent className="size-4" />}
          {label}
        </CardTitle>
        <div className="flex items-baseline gap-2">
          <span className="text-[19px] leading-6 font-medium text-foreground tabular-nums">{value}</span>
          {delta}
        </div>
      </CardHeader>
      {children && <CardContent className="px-4">{children}</CardContent>}
    </Card>
  );
}

export function DeliverableCard({ icon: IconComponent, caption, href }: { icon: Icon; caption: ReactNode; href?: string }) {
  const card = (
    <Card data-slot="deliverable-card" className="gap-0 overflow-hidden rounded-xl py-0 shadow-none transition-colors hover:border-foreground/20">
      <CardContent className="grid h-28 place-items-center bg-surface-head px-4">
        <IconComponent className="size-8 text-muted-foreground" />
      </CardContent>
      <CardFooter className="border-t border-border px-4 py-3 text-[13px] text-foreground">{caption}</CardFooter>
    </Card>
  );
  return href ? (
    <UiLink href={href} className="block rounded-xl focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none">
      {card}
    </UiLink>
  ) : (
    card
  );
}
