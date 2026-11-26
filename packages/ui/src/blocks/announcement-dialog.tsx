"use client";

import type { ComponentType, ReactNode } from "react";
import { Button } from "@modelstill/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@modelstill/ui/components/dialog";
import { cn } from "@modelstill/ui/lib/utils";

type Icon = ComponentType<{ className?: string }>;

export type TerminalLine = { key: string; icon: Icon; text: ReactNode };

export function MockTerminal({ lines, className }: { lines: readonly TerminalLine[]; className?: string }) {
  return (
    <div data-slot="mock-terminal" className={cn("rounded-tl-xl border-t border-l border-white/60 bg-card px-5 pt-3.5 pb-4", className)}>
      <div aria-hidden="true" className="mb-3.5 flex gap-1.5">
        <span className="size-2.5 rounded-full bg-negative" />
        <span className="size-2.5 rounded-full bg-chart-4" />
        <span className="size-2.5 rounded-full bg-positive" />
      </div>
      <ul className="flex flex-col gap-3">
        {lines.map((line) => {
          const IconComponent = line.icon;
          return (
            <li key={line.key} className="flex items-center gap-2.5 font-mono text-[12.5px] text-foreground/80">
              <IconComponent className="size-3.5 shrink-0 text-muted-foreground" />
              {line.text}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export type AnnouncementDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lines: readonly TerminalLine[];
  title: ReactNode;
  description: ReactNode;
  action: ReactNode;
  onAction: () => void;
  gradient?: "aurora" | "tide" | "dawn" | "mist";
};

export function AnnouncementDialog({ open, onOpenChange, lines, title, description, action, onAction, gradient = "aurora" }: AnnouncementDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="gap-0 overflow-hidden rounded-[28px] p-0 sm:max-w-[520px]">
        <div aria-hidden="true" className={cn("pt-10 pl-10", `ms-gradient-${gradient}`)}>
          <MockTerminal lines={lines} />
        </div>
        <div className="flex flex-col gap-7 px-8 pt-7 pb-8">
          <DialogHeader className="gap-2 text-left">
            <DialogTitle className="text-[19px] leading-6 font-medium">{title}</DialogTitle>
            <DialogDescription className="text-[14px] leading-6">{description}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-stretch">
            <Button type="button" onClick={onAction} className="w-full bg-foreground text-background hover:bg-foreground/90">
              {action}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
