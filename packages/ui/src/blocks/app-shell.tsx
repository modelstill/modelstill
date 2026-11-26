"use client";

import type { ReactNode } from "react";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@modelstill/ui/components/sidebar";
import { TooltipProvider } from "@modelstill/ui/components/tooltip";
import { cn } from "@modelstill/ui/lib/utils";

export type AppShellProps = {
  sidebar: ReactNode;
  topbar?: ReactNode;
  topbarActions?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
};

export function AppShell({ sidebar, topbar, topbarActions, defaultOpen = true, children, className }: AppShellProps) {
  return (
    <TooltipProvider delayDuration={250}>
      <SidebarProvider defaultOpen={defaultOpen} className="h-svh overflow-hidden">
        {sidebar}
        <SidebarInset className={cn("min-h-0 overflow-hidden", className)}>
          <header data-slot="app-shell-topbar" className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-3 md:rounded-t-xl">
            <SidebarTrigger />
            <div className="flex min-w-0 flex-1 items-center gap-2">{topbar}</div>
            {topbarActions && <div className="flex shrink-0 items-center gap-2">{topbarActions}</div>}
          </header>
          <div data-slot="app-shell-content" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
