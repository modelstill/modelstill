"use client";

import type { ReactNode } from "react";
import { Badge } from "@modelstill/ui/components/badge";
import { Card as UICard, CardContent } from "@modelstill/ui/components/card";
import { Table as UITable, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@modelstill/ui/components/table";
import { cn } from "@modelstill/ui/lib/utils";

export { PageBody } from "@modelstill/ui/blocks/section";
export { PageHeader } from "@modelstill/ui/blocks/page-header";
export { StatCard } from "@modelstill/ui/blocks/stat-card";

export function Card({ children, className, contentClassName }: { children: ReactNode; className?: string; contentClassName?: string }) {
  return (
    <UICard className={cn("gap-0 rounded-xl border-border py-0 shadow-none", className)}>
      <CardContent className={cn("p-5", contentClassName)}>{children}</CardContent>
    </UICard>
  );
}

export function CardTitle({ icon, children, className }: { icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-1.5 text-[13px] leading-4 font-normal text-muted-foreground [&>svg]:size-3.5 [&>svg]:shrink-0", className)}>
      {icon}
      {children}
    </div>
  );
}

const TONE = {
  green: "bg-status-ok-bg text-status-ok",
  amber: "bg-status-warn-bg text-status-warn",
  red: "bg-status-fail-bg text-status-fail",
  blue: "bg-status-run-bg text-status-run",
  primary: "bg-background text-foreground/80 ring-1 ring-inset ring-border",
  neutral: "bg-muted text-muted-foreground",
} as const;

export type StatusTone = keyof typeof TONE;

export function StatusBadge({ children, tone = "neutral", className }: { children: ReactNode; tone?: StatusTone; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("h-5 gap-1 rounded-[5px] border-transparent px-1.5 py-0 text-[12.5px] leading-4 font-medium shadow-none ring-0", TONE[tone], className)}
    >
      {children}
    </Badge>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("text-[13px] leading-4 font-medium text-muted-foreground", className)}>{children}</div>;
}

export function CardHeading({ icon, title, description, action }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 type-title text-foreground [&>svg]:size-4 [&>svg]:text-primary">
          {icon}
          {title}
        </h2>
        {description && <p className="mt-1 text-[12.5px] text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function MetricRow({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <div className="mt-1.5 text-[14px] font-medium text-foreground">{value}</div>
      {hint && <div className="mt-0.5 text-[13px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <UITable className="text-[13.5px]">
        <TableHeader>
          <TableRow className="border-border bg-transparent text-[13px] leading-4 text-muted-foreground hover:bg-transparent">{head}</TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </UITable>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <TableHead className={cn("h-9 px-4 py-0 font-normal text-muted-foreground", className)}>{children}</TableHead>;
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <TableCell className={cn("h-10 px-4 py-1.5 text-foreground/85 tabular-nums", className)}>{children}</TableCell>;
}

export function Tr({ children }: { children: ReactNode }) {
  return <TableRow className="border-border hover:bg-muted/50">{children}</TableRow>;
}

export function TableFootnote({ children, end, className }: { children: ReactNode; end?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 border-t border-border px-4 py-2 text-[12.5px] text-muted-foreground tabular-nums", className)}>
      <span>{children}</span>
      {end}
    </div>
  );
}

export function EmptyPanel({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">{children}</p>;
}
