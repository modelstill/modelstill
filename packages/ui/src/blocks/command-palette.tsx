"use client";

import { Fragment, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { Button } from "@modelstill/ui/components/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@modelstill/ui/components/command";
import { Kbd } from "@modelstill/ui/components/kbd";
import { cn } from "@modelstill/ui/lib/utils";

export type CommandPaletteItem = {
  id: string;
  label: ReactNode;
  value?: string;
  hint?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  keywords?: string[];
  onSelect: () => void;
};

export type CommandPaletteGroup = { heading: string; items: CommandPaletteItem[] };

export type CommandPaletteProps = {
  groups: CommandPaletteGroup[];
  placeholder?: string;
  hotkey?: string;
  trigger?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
};

export function CommandPalette({
  groups,
  placeholder = "Jump to a task or page...",
  hotkey = "k",
  trigger = false,
  open: openProp,
  onOpenChange,
  className,
}: CommandPaletteProps) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = openProp ?? ownOpen;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOwnOpen(next);
    onOpenChange?.(next);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === hotkey && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (openProp === undefined) setOwnOpen((value) => !value);
        onOpenChange?.(!open);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hotkey, open, openProp, onOpenChange]);

  return (
    <>
      {trigger && (
        <Button
          type="button"
          variant="ghost"
          onClick={() => setOpen(true)}
          aria-label="Search"
          className={cn(
            "h-8 w-full justify-start gap-2 rounded-md border border-sidebar-border bg-background px-2.5 text-[13.5px] leading-4 font-normal text-muted-foreground hover:bg-background hover:text-foreground group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0",
            className,
          )}
        >
          <MagnifyingGlassIcon aria-hidden="true" data-icon="inline-start" />
          <span className="flex-1 truncate text-left group-data-[collapsible=icon]:hidden">Search</span>
          <Kbd className="h-5 border border-border text-[11px] group-data-[collapsible=icon]:hidden">⌘{hotkey.toUpperCase()}</Kbd>
        </Button>
      )}
      <CommandDialog open={open} onOpenChange={setOpen} title="Command palette" description="Jump to a task or a page">
        <CommandInput placeholder={placeholder} />
        <CommandList>
          <CommandEmpty>No match.</CommandEmpty>
          {groups.map((group, index) => (
            <Fragment key={group.heading}>
              {index > 0 && <CommandSeparator />}
              <CommandGroup heading={group.heading}>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <CommandItem
                      key={item.id}
                      value={item.value ?? `${group.heading} ${item.id}`}
                      keywords={item.keywords}
                      onSelect={() => {
                        item.onSelect();
                        setOpen(false);
                      }}
                    >
                      {Icon && <Icon className="text-muted-foreground" />}
                      <span className="truncate">{item.label}</span>
                      {item.hint && <CommandShortcut>{item.hint}</CommandShortcut>}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </Fragment>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}
