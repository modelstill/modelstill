"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { BookOpenIcon, KeyboardIcon, KeyIcon, MoonIcon, PlugsConnectedIcon, SignOutIcon, StackIcon, SunIcon, TerminalWindowIcon } from "@phosphor-icons/react";
import { ModeBadge } from "@modelstill/ui/blocks/mode-badge";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@modelstill/ui/components/command";
import { Kbd, KbdGroup } from "@modelstill/ui/components/kbd";
import type { Task } from "@/lib/api";
import { DOCS_URL } from "@/lib/links";
import { API_KEYS_HREF, CONNECT_HREF, settingsNav, taskHref, taskNavGroups } from "@/lib/nav";
import { goKeysFor } from "@/lib/shortcuts";
import { THEME_SWITCHING_ENABLED } from "@/lib/theme";
import { NAV_ICONS, SECTION_ICONS } from "./section-icons";
import type { AccountActions } from "./user-menu";

function Keys({ keys }: { keys: string[] | null }) {
  if (!keys) return null;
  return (
    <CommandShortcut className="flex gap-1 tracking-normal">
      {keys.map((key, index) => (
        <Kbd key={`${key}-${index}`}>{key}</Kbd>
      ))}
    </CommandShortcut>
  );
}

export function CommandPalette({
  open,
  onOpenChange,
  tasks,
  slug,
  account,
  onShortcuts = () => {},
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: Task[] | null;
  slug: string | null;
  account: AccountActions;
  onShortcuts?: () => void;
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenChange(!openRef.current);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onOpenChange]);

  function go(href: string) {
    onOpenChange(false);
    account.navigate(href);
  }

  const dark = resolvedTheme === "dark";

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Command palette" description="Search tasks, pages and actions" className="sm:max-w-[640px]">
      <CommandInput placeholder="Find a page, task or action..." className="h-12 text-[15px]" />
      <div className="flex items-center gap-1.5 border-b border-line-cell px-3 py-1.5 text-[12px] text-muted-foreground">
        <KbdGroup>
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
        opens this anywhere
        <span className="ml-auto flex items-center gap-1">
          <Kbd>?</Kbd> all shortcuts
        </span>
      </div>
      <CommandList className="max-h-[420px]">
        <CommandEmpty>Nothing matches.</CommandEmpty>

        {slug &&
          taskNavGroups(slug).map((group) => (
            <CommandGroup key={group.label ?? "task"} heading={group.label ? `${group.label} · ${slug}` : slug}>
              {group.items.map((section) => {
                const Icon = SECTION_ICONS[section.key];
                return (
                  <CommandItem key={section.key} value={`page ${slug} ${group.label ?? ""} ${section.label}`} onSelect={() => go(section.href)} className="h-9">
                    <Icon className="size-4 text-muted-foreground" />
                    {section.label}
                    <Keys keys={goKeysFor(section.key)} />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}

        <CommandGroup heading="Actions">
          <CommandItem value="create api key" onSelect={() => go(API_KEYS_HREF)} className="h-9">
            <KeyIcon className="size-4 text-primary" />
            Create an API key
          </CommandItem>
          <CommandItem value="connect coding agent mcp" onSelect={() => go(CONNECT_HREF)} className="h-9">
            <PlugsConnectedIcon className="size-4 text-primary" />
            Connect a coding agent
          </CommandItem>
          <CommandItem
            value="keyboard shortcuts help"
            onSelect={() => {
              onOpenChange(false);
              onShortcuts();
            }}
            className="h-9"
          >
            <KeyboardIcon className="size-4 text-primary" />
            Show keyboard shortcuts
            <Keys keys={["?"]} />
          </CommandItem>
          {THEME_SWITCHING_ENABLED && (
            <CommandItem
              value="toggle theme dark light"
              onSelect={() => {
                onOpenChange(false);
                setTheme(dark ? "light" : "dark");
              }}
              className="h-9"
            >
              {dark ? <SunIcon className="size-4 text-primary" /> : <MoonIcon className="size-4 text-primary" />}
              {dark ? "Switch to light theme" : "Switch to dark theme"}
            </CommandItem>
          )}
        </CommandGroup>

        <CommandGroup heading="Tasks">
          <CommandItem value="all tasks list" onSelect={() => go("/tasks")} className="h-9">
            <StackIcon className="size-4 text-muted-foreground" />
            All tasks
            <Keys keys={["G", "L"]} />
          </CommandItem>
          {(tasks ?? []).map((task) => (
            <CommandItem key={task.slug} value={`task ${task.slug}`} onSelect={() => go(taskHref(task.slug))} className="h-9">
              <TerminalWindowIcon className="size-4 text-muted-foreground" />
              <span className="font-mono text-[12.5px]">{task.slug}</span>
              <span className="ml-auto">
                <ModeBadge mode={task.mode} />
              </span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading="Settings">
          {settingsNav(slug).flatMap((section) =>
            section.items.map((item) => {
              const Icon = NAV_ICONS[item.key];
              return (
                <CommandItem key={item.href} value={`settings ${section.label ?? ""} ${item.label}`} onSelect={() => go(item.href)} className="h-9">
                  <Icon className="size-4 text-muted-foreground" />
                  {section.label === "Task" ? `Task settings` : item.label}
                </CommandItem>
              );
            }),
          )}
        </CommandGroup>

        <CommandGroup heading="Help">
          <CommandItem
            value="docs documentation help"
            onSelect={() => {
              onOpenChange(false);
              window.open(DOCS_URL, "_blank", "noopener,noreferrer");
            }}
            className="h-9"
          >
            <BookOpenIcon className="size-4 text-muted-foreground" />
            Docs
          </CommandItem>
          <CommandItem
            value="sign out log out"
            onSelect={() => {
              onOpenChange(false);
              void account.onSignOut().then(() => account.navigate("/login"));
            }}
            className="h-9"
          >
            <SignOutIcon className="size-4 text-muted-foreground" />
            Log out
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
