"use client";

import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CaretUpDownIcon, CheckIcon, SidebarSimpleIcon, StackIcon } from "@phosphor-icons/react";
import { ModeBadge } from "@modelstill/ui/blocks/mode-badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@modelstill/ui/components/breadcrumb";
import { Button } from "@modelstill/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@modelstill/ui/components/dropdown-menu";
import { Kbd } from "@modelstill/ui/components/kbd";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@modelstill/ui/components/tooltip";
import { cn } from "@modelstill/ui/lib/utils";
import type { Task } from "@/lib/api";
import { breadcrumbs, sectionForPath, slugFromPath, taskHref } from "@/lib/nav";
import { CrumbBadgeSlot, PageActionsSlot } from "./page-actions";
import { PAGE_ICONS } from "./section-icons";

const ICON_BUTTON = "size-7 rounded-md text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground";

function Hint({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function suffixAfterTask(pathname: string, slug: string): string {
  const match = /^\/[^/]+/.exec(pathname.slice(taskHref(slug).length));
  return match ? match[0] : "";
}

function TaskCrumb({ slug, tasks }: { slug: string; tasks: Task[] | null }) {
  const router = useRouter();
  const pathname = usePathname() ?? taskHref(slug);
  const suffix = suffixAfterTask(pathname, slug);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" aria-label="Switch task" className="h-8 max-w-[220px] gap-1 rounded-md px-1.5 font-mono text-[12.5px] font-normal text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground data-[state=open]:bg-sidebar-accent">
          <span className="truncate">{slug}</span>
          <CaretUpDownIcon aria-hidden="true" className="size-3.5 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="w-[260px] p-1.5">
        <DropdownMenuLabel className="text-[12px] font-normal text-muted-foreground">Switch task</DropdownMenuLabel>
        {(tasks ?? []).map((task) => (
          <DropdownMenuItem key={task.slug} onSelect={() => router.push(`${taskHref(task.slug)}${suffix}`)} className="cursor-pointer gap-2 py-1.5">
            <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{task.slug}</span>
            <ModeBadge mode={task.mode} />
            {task.slug === slug && <CheckIcon aria-label="current task" className="size-3.5 text-primary" />}
          </DropdownMenuItem>
        ))}
        {tasks === null && <p className="px-2 py-1.5 text-[12.5px] text-muted-foreground">Loading tasks...</p>}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="cursor-pointer gap-2 py-1.5 text-[13px]">
          <Link href="/tasks">
            <StackIcon className="size-4 text-muted-foreground" />
            All tasks
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Topbar({ onToggle, tasks }: { onToggle: () => void; tasks: Task[] | null }) {
  const pathname = usePathname() ?? "/tasks";
  const crumbs = breadcrumbs(pathname);
  const slug = slugFromPath(pathname);
  const CrumbIcon = PAGE_ICONS[sectionForPath(pathname)];
  return (
    <header data-slot="topbar" className="flex h-11 shrink-0 items-center gap-1.5 pr-2 pl-1 lg:pl-2">
      <Hint
        label={
          <span className="flex items-center gap-1.5">
            Toggle sidebar <Kbd>[</Kbd>
          </span>
        }
      >
        <Button variant="ghost" size="icon" onClick={onToggle} aria-label="Toggle sidebar" className={cn(ICON_BUTTON, "lg:hidden")}>
          <SidebarSimpleIcon className="size-4" />
        </Button>
      </Hint>
      <Breadcrumb className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        <CrumbIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <BreadcrumbList className="flex-nowrap gap-1 text-[14px] sm:gap-1">
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            const isTask = slug !== null && index === 1 && crumb.label === slug;
            return (
              <Fragment key={`${crumb.label}-${index}`}>
                {index > 0 && <BreadcrumbSeparator className="text-muted-foreground/60">/</BreadcrumbSeparator>}
                <BreadcrumbItem className="min-w-0">
                  {isTask && !last ? (
                    <TaskCrumb slug={slug} tasks={tasks} />
                  ) : last || !crumb.href ? (
                    <BreadcrumbPage className={isTask ? "truncate font-mono text-[12.5px] font-medium text-foreground" : "truncate font-medium text-foreground"}>{crumb.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild className="truncate px-1 font-normal text-muted-foreground hover:text-foreground">
                      <Link href={crumb.href}>{crumb.label}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </Fragment>
            );
          })}
        </BreadcrumbList>
        <CrumbBadgeSlot className="flex shrink-0 items-center" />
      </Breadcrumb>
      <PageActionsSlot className="flex shrink-0 items-center gap-1" />
    </header>
  );
}
