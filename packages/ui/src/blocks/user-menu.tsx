"use client";

import type { ComponentType, ReactNode } from "react";
import { CaretUpDownIcon } from "@phosphor-icons/react";
import { Button } from "@modelstill/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@modelstill/ui/components/dropdown-menu";
import { cn } from "@modelstill/ui/lib/utils";

export type UserMenuItem = {
  id: string;
  label: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  onSelect: () => void;
  separatorBefore?: boolean;
};

export type UserMenuProps = {
  name: string;
  detail?: string;
  items: UserMenuItem[];
  compact?: boolean;
  side?: "top" | "bottom" | "right";
  className?: string;
};

function Avatar({ name, size }: { name: string; size: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="grid shrink-0 place-items-center rounded-full bg-primary text-xs font-medium text-primary-foreground ring-1 ring-border"
    >
      {(name || "M").trim().charAt(0).toUpperCase()}
    </span>
  );
}

export function UserMenu({ name, detail, items, compact = false, side = "top", className }: UserMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          aria-label={compact ? name : undefined}
          data-slot="user-menu"
          className={cn(
            "flex h-auto w-full items-center justify-start gap-2.5 rounded-md px-1.5 py-1.5 text-left font-normal hover:bg-sidebar-accent/70 data-[state=open]:bg-sidebar-accent group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0",
            className,
          )}
        >
          <Avatar name={name} size={28} />
          {!compact && (
            <>
              <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                <span className="block truncate text-[13px] leading-4 font-medium text-foreground">{name}</span>
                {detail && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}
              </span>
              <CaretUpDownIcon aria-hidden="true" className="text-muted-foreground group-data-[collapsible=icon]:hidden" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={side} align="start" sideOffset={8} className="w-[256px] p-2">
        <div className="flex items-center gap-2.5 px-2 py-2">
          <Avatar name={name} size={32} />
          <span className="min-w-0">
            <span className="block truncate text-[13px] leading-4 font-medium text-foreground">{name}</span>
            {detail && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}
          </span>
        </div>
        {items.map((item, index) => {
          const Icon = item.icon;
          return (
            <div key={item.id} className="contents">
              {(index === 0 || item.separatorBefore) && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={item.onSelect} className="gap-3">
                {Icon && <Icon aria-hidden="true" />}
                <span className="text-[13.5px] text-foreground">{item.label}</span>
              </DropdownMenuItem>
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
