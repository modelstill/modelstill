"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import { CaretUpDownIcon, CheckIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { Button } from "@modelstill/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@modelstill/ui/components/dropdown-menu";
import { cn } from "@modelstill/ui/lib/utils";

export type SwitcherItem = { id: string; label: string; meta?: ReactNode };

export type SwitcherAction = {
  id: string;
  label: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  onSelect: () => void;
};

export type WorkspaceSwitcherProps = {
  label: string;
  items: SwitcherItem[] | null;
  activeId: string | null;
  onSelect: (id: string) => void;
  heading?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  loadingText?: string;
  actions?: SwitcherAction[];
  mono?: boolean;
  className?: string;
};

function initial(name: string) {
  return (name || "M").trim().charAt(0).toUpperCase();
}

function Tile({ name, small = false }: { name: string; small?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center bg-primary/12 text-[11px] font-medium text-primary",
        small ? "size-5 rounded-[5px]" : "size-6 rounded-sm",
      )}
    >
      {initial(name)}
    </span>
  );
}

function EmptyTile() {
  return <span aria-hidden="true" className="size-5 shrink-0 rounded-[5px] border border-dashed border-border" />;
}

export function WorkspaceSwitcher({
  label,
  items,
  activeId,
  onSelect,
  heading,
  placeholder = "Select",
  searchPlaceholder = "Find...",
  emptyText = "Nothing here yet",
  loadingText = "Loading...",
  actions = [],
  mono = false,
  className,
}: WorkspaceSwitcherProps) {
  const [query, setQuery] = useState("");
  const active = items?.find((item) => item.id === activeId) ?? null;
  const needle = query.trim().toLowerCase();
  const filtered = (items ?? []).filter((item) => item.label.toLowerCase().includes(needle));
  const current = active?.label ?? activeId;
  const name = current ?? placeholder;

  return (
    <DropdownMenu onOpenChange={(open) => !open && setQuery("")}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          aria-label={label}
          data-slot="workspace-switcher"
          className={cn(
            "h-8 w-full justify-start gap-2 rounded-md border-sidebar-border bg-sidebar-accent px-1.5 text-left font-normal hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent",
            className,
          )}
        >
          {current ? <Tile name={current} small /> : <EmptyTile />}
          <span className={cn("min-w-0 flex-1 truncate text-[13px] leading-4 font-medium text-foreground", mono && current && "font-mono text-xs", !current && "text-muted-foreground")}>
            {name}
          </span>
          <CaretUpDownIcon aria-hidden="true" className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="w-[248px]">
        <div className="mb-1.5 flex items-center gap-2 rounded-md bg-muted px-2.5 ring-1 ring-border">
          <MagnifyingGlassIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="h-8 w-full border-0 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        {heading && <DropdownMenuLabel className="px-2 text-xs font-normal text-muted-foreground">{heading}</DropdownMenuLabel>}
        {items === null && <DropdownMenuItem disabled>{loadingText}</DropdownMenuItem>}
        {items !== null && filtered.length === 0 && <DropdownMenuItem disabled>{emptyText}</DropdownMenuItem>}
        {filtered.map((item) => (
          <DropdownMenuItem key={item.id} onSelect={() => onSelect(item.id)}>
            <Tile name={item.label} />
            <span className={cn("min-w-0 flex-1 truncate text-[13px] text-foreground", mono && "font-mono text-xs")}>{item.label}</span>
            {item.meta}
            {item.id === activeId && <CheckIcon aria-hidden="true" className="text-primary" />}
          </DropdownMenuItem>
        ))}
        {actions.length > 0 && <DropdownMenuSeparator />}
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <DropdownMenuItem key={action.id} onSelect={action.onSelect}>
              {Icon && <Icon aria-hidden="true" />}
              <span className="text-[13px] text-foreground">{action.label}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
