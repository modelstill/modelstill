"use client";

import { Fragment, type ReactNode } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@modelstill/ui/components/breadcrumb";
import { cn } from "@modelstill/ui/lib/utils";
import { UiLink } from "./link";

export type Crumb = { label: ReactNode; href?: string; key?: string };

export function BreadcrumbTrail({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <Breadcrumb className={cn("min-w-0", className)}>
      <BreadcrumbList className="flex-nowrap gap-2 text-base sm:gap-2">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <Fragment key={item.key ?? index}>
              {index > 0 && <BreadcrumbSeparator className="text-muted-foreground/70">/</BreadcrumbSeparator>}
              <BreadcrumbItem className="min-w-0">
                {last || !item.href ? (
                  <BreadcrumbPage className="truncate font-medium text-foreground">{item.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild className="truncate font-normal text-muted-foreground hover:text-foreground">
                    <UiLink href={item.href}>{item.label}</UiLink>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: Crumb[];
  meta?: ReactNode;
  icon?: ReactNode;
  className?: string;
};

export function PageHeader({ title, description, actions, breadcrumb, meta, icon, className }: PageHeaderProps) {
  return (
    <header data-slot="page-header" className={cn("flex flex-col gap-2", className)}>
      {breadcrumb && breadcrumb.length > 0 && <BreadcrumbTrail items={breadcrumb} />}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="flex min-w-0 items-center gap-2 type-title text-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground">
            {icon}
            <span className="truncate">{title}</span>
          </h1>
          {description && <p className="max-w-2xl text-[13.5px] text-muted-foreground">{description}</p>}
          {meta && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">{meta}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
