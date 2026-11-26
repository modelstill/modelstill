"use client";

import type { ComponentType, ReactNode } from "react";
import { CaretLeftIcon } from "@phosphor-icons/react";
import { Table, TableBody, TableCell, TableRow } from "@modelstill/ui/components/table";
import { cn } from "@modelstill/ui/lib/utils";
import { UiLink } from "./link";

type Icon = ComponentType<{ className?: string; weight?: "regular" | "duotone" | "fill" | "bold" }>;

export function IconTile({ icon: IconComponent, size = "md", className }: { icon: Icon; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <span
      data-slot="icon-tile"
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-xl border border-border bg-card text-brand shadow-[0_1px_2px_rgb(16_16_24/0.05),0_4px_10px_-6px_rgb(16_16_24/0.12)]",
        size === "sm" && "size-8 rounded-lg [&_svg]:size-4",
        size === "md" && "size-11 [&_svg]:size-6",
        size === "lg" && "size-14 rounded-2xl [&_svg]:size-7",
        className,
      )}
    >
      <IconComponent weight="duotone" />
    </span>
  );
}

export type DetailHeaderProps = {
  backHref?: string;
  backLabel?: ReactNode;
  icon: Icon;
  title: ReactNode;
  badge?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
};

export function DetailHeader({ backHref, backLabel = "Back", icon, title, badge, description, actions, children }: DetailHeaderProps) {
  return (
    <header data-slot="detail-header" className="flex flex-col gap-5">
      {backHref && (
        <UiLink href={backHref} className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
          <CaretLeftIcon aria-hidden="true" className="size-3.5" />
          {backLabel}
        </UiLink>
      )}
      <IconTile icon={icon} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <h1 className="min-w-0 truncate type-title text-foreground">{title}</h1>
            {badge}
          </div>
          {description && <p className="text-[13.5px] leading-5 text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

export type SpecRow = { label: ReactNode; value: ReactNode; key?: string };

export function SpecTable({ rows, className }: { rows: readonly SpecRow[]; className?: string }) {
  return (
    <div data-slot="spec-table" className={cn("overflow-hidden rounded-xl border border-border bg-card", className)}>
      <Table>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={row.key ?? index} className="hover:bg-transparent">
              <TableCell className="h-(--list-row-h) w-[38%] border-r border-border px-4 text-[13px] text-muted-foreground">{row.label}</TableCell>
              <TableCell className="h-(--list-row-h) px-4 text-[13px] whitespace-normal text-foreground">{row.value}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="type-title text-foreground">{children}</h2>
      {action}
    </div>
  );
}
