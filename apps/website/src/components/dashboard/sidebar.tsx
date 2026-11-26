"use client";

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CaretLeftIcon,
  CaretUpDownIcon,
  CaretUpIcon,
  CheckCircleIcon,
  DotsThreeIcon,
  GearSixIcon,
  KeyIcon,
  MagnifyingGlassIcon,
  PlugsConnectedIcon,
  RocketLaunchIcon,
  SidebarSimpleIcon,
  SignOutIcon,
  StackIcon,
} from "@phosphor-icons/react";
import { LogoMark, PRODUCT_NAME } from "@modelstill/ui/blocks/brand";
import { ProgressRing } from "@modelstill/ui/blocks/progress-ring";
import { Button } from "@modelstill/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@modelstill/ui/components/dropdown-menu";
import { Input } from "@modelstill/ui/components/input";
import { progressOf } from "@modelstill/ui/lib/steps";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@modelstill/ui/components/tooltip";
import { cn } from "@modelstill/ui/lib/utils";
import { Fade } from "@/components/motion/fade";
import { Highlight, HighlightItem } from "@/components/motion/highlight";
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs";
import type { Task } from "@/lib/api";
import { setupSteps, visibleTasks } from "@/lib/get-started";
import {
  activeHref,
  activeTaskSection,
  API_KEYS_HREF,
  CONNECT_HREF,
  GET_STARTED_HREF,
  taskHref,
  isSettingsPath,
  MAIN_NAV,
  PROFILE_HREF,
  settingsNav,
  slugFromPath,
  taskNavGroups,
  taskSettingsHref,
  type NavSection,
} from "@/lib/nav";
import { DURATION, SLIDE_SPRING } from "@/lib/motion";
import type { SessionUser } from "@/lib/session";
import { HelpMenu } from "./help-menu";
import { NAV_ICONS, SECTION_ICONS } from "./section-icons";
import { UserMenu, type AccountActions } from "./user-menu";

export const SIDEBAR_WIDTH = 224;
export const SIDEBAR_RAIL = 52;

const ROW = "h-8 rounded-md text-[13.5px] leading-4 font-medium";
const TASK_LIMIT = 3;
const GROUP_LABEL = "flex h-6 items-end px-2 pb-1 text-[12px] leading-4 font-normal text-muted-foreground";
const ICON_BUTTON = "size-7 rounded-md px-0 text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground [&_svg]:size-4";

type Icon = ComponentType<{ className?: string }>;

function RailTooltip({ label, side = "right", children }: { label: string; side?: "right" | "top"; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}

function NavLabel({ mono, children }: { mono: boolean; children: ReactNode }) {
  return (
    <Fade asChild transition={{ duration: DURATION.fast }}>
      <span className={cn("relative truncate", mono && "font-mono text-[12.5px]")}>{children}</span>
    </Fade>
  );
}

function NavLink({
  href,
  label,
  icon: IconComponent,
  active,
  tabbable,
  compact,
  onNavigate,
  trailing,
}: {
  href: string;
  label: string;
  icon: Icon;
  active: boolean;
  tabbable: boolean;
  compact: boolean;
  onNavigate: (href: string) => void;
  trailing?: ReactNode;
}) {
  const link = (
    <Link
      href={href}
      onClick={() => onNavigate(href)}
      tabIndex={tabbable ? 0 : -1}
      aria-label={compact ? label : undefined}
      aria-current={active ? "page" : undefined}
      data-active={active || undefined}
      className={cn(
        "relative flex items-center transition-colors",
        ROW,
        compact ? "w-7 justify-center px-0" : "gap-2 px-2",
        active ? "text-foreground" : "text-foreground/75 hover:bg-sidebar-accent/70 hover:text-foreground",
      )}
    >
      <IconComponent className={cn("relative size-4 shrink-0", active ? "text-foreground" : "text-muted-foreground")} />
      {!compact && <NavLabel mono={false}>{label}</NavLabel>}
      {!compact && trailing && <span className="relative ml-auto flex items-center">{trailing}</span>}
    </Link>
  );
  return (
    <HighlightItem value={href} className={cn(compact && "w-7")}>
      {compact ? <RailTooltip label={label}>{link}</RailTooltip> : link}
    </HighlightItem>
  );
}

function NavPanelHighlight({ value, children }: { value: string | null; children: ReactNode }) {
  return (
    <Highlight value={value} transition={SLIDE_SPRING} className="inset-0 rounded-md bg-sidebar-accent">
      {children}
    </Highlight>
  );
}

type Entry = { key: string; href: string; label: string; icon: Icon; trailing?: ReactNode };

function NavGroup({
  label,
  entries,
  isActive,
  tabbable,
  compact,
  onNavigate,
  first,
}: {
  label: string | null;
  entries: Entry[];
  isActive: (href: string) => boolean;
  tabbable: boolean;
  compact: boolean;
  onNavigate: (href: string) => void;
  first?: boolean;
}) {
  return (
    <div className={cn(first ? "mt-1" : label ? "mt-2" : "mt-1", compact ? "flex flex-col items-center" : "px-2")}>
      {label && !compact && <div className={GROUP_LABEL}>{label}</div>}
      {label && compact && <div aria-hidden="true" className="my-1.5 h-px w-5 bg-sidebar-border" />}
      <nav aria-label={label ?? undefined} className={cn("flex flex-col gap-0.5", compact && "items-center")}>
        {entries.map((entry) => (
          <NavLink
            key={entry.key}
            href={entry.href}
            label={entry.label}
            icon={entry.icon}
            active={isActive(entry.href)}
            tabbable={tabbable}
            compact={compact}
            onNavigate={onNavigate}
            trailing={entry.trailing}
          />
        ))}
      </nav>
    </div>
  );
}

function sectionEntries(section: NavSection): Entry[] {
  return section.items.map((item) => ({ key: item.href, href: item.href, label: item.label, icon: NAV_ICONS[item.key] }));
}

function navHrefs(sections: NavSection[]): string[] {
  return sections.flatMap((section) => section.items.map((item) => item.href));
}

function filterSections(sections: NavSection[], query: string): NavSection[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return sections;
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => `${section.label ?? ""} ${item.label}`.toLowerCase().includes(needle)),
    }))
    .filter((section) => section.items.length > 0);
}


function WorkspaceMenu({
  tasks,
  slug,
  compact,
  account,
  onSearch,
  onToggle,
  onNavigate,
}: {
  tasks: Task[] | null;
  slug: string | null;
  compact: boolean;
  account: AccountActions;
  onSearch: () => void;
  onToggle?: () => void;
  onNavigate: (href: string) => void;
}) {
  const go = (href: string) => {
    onNavigate(href);
    account.navigate(href);
  };
  const toggleLabel = compact ? "Expand sidebar" : "Collapse sidebar";
  const toggle = onToggle && (
    <RailTooltip label={toggleLabel} side={compact ? "right" : "top"}>
      <Button variant="ghost" onClick={onToggle} aria-label={toggleLabel} className={ICON_BUTTON}>
        <SidebarSimpleIcon />
      </Button>
    </RailTooltip>
  );
  return (
    <div className={cn("flex shrink-0 items-center", compact ? "flex-col gap-2 px-0 pt-3 pb-1" : "h-12 gap-1 px-2.5")}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            aria-label="Switch task"
            className={cn(
              "h-8 gap-2 rounded-md px-1.5 font-normal text-foreground hover:bg-sidebar-accent/70 data-[state=open]:bg-sidebar-accent",
              compact ? "w-8 justify-center px-0" : "min-w-0 flex-1 justify-start",
            )}
          >
            <LogoMark size={20} />
            {!compact && (
              <>
                <span className="truncate text-[14px] font-medium">{PRODUCT_NAME}</span>
                <CaretUpDownIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
              </>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side={compact ? "right" : "bottom"} sideOffset={6} className="w-[248px] p-1.5">
          <DropdownMenuLabel className="text-[12px] font-normal text-muted-foreground">Tasks</DropdownMenuLabel>
          <DropdownMenuGroup>
            {(tasks ?? []).map((task) => (
              <DropdownMenuItem key={task.slug} onSelect={() => go(taskHref(task.slug))} className="h-8 gap-2.5 text-[13.5px]">
                <span aria-hidden="true" className="grid size-5 place-items-center rounded-[5px] bg-brand-wash font-mono text-[11px] text-brand-text">
                  {task.slug.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate">{task.slug}</span>
                {task.slug === slug && <CheckCircleIcon aria-label="current task" weight="fill" className="text-foreground" />}
              </DropdownMenuItem>
            ))}
            {tasks === null && <DropdownMenuItem disabled>Loading tasks...</DropdownMenuItem>}
            {tasks !== null && tasks.length === 0 && <DropdownMenuItem disabled>No tasks yet</DropdownMenuItem>}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => go("/tasks")} className="h-8 gap-2.5 text-[13.5px]">
              <StackIcon />
              All tasks
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => go(GET_STARTED_HREF)} className="h-8 gap-2.5 text-[13.5px]">
              <RocketLaunchIcon />
              Get started
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => go(CONNECT_HREF)} className="h-8 gap-2.5 text-[13.5px]">
              <PlugsConnectedIcon />
              Connect via MCP
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => go(API_KEYS_HREF)} className="h-8 gap-2.5 text-[13.5px]">
              <KeyIcon />
              API keys
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => void account.onSignOut().then(() => account.navigate("/login"))} className="h-8 gap-2.5 text-[13.5px]">
              <SignOutIcon />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {compact ? (
        <>
          <span aria-hidden="true" className="h-px w-6 bg-sidebar-border" />
          {toggle}
        </>
      ) : (
        <>
          <RailTooltip label="Search  ⌘K" side="top">
            <Button variant="ghost" onClick={onSearch} aria-label="Search" className={ICON_BUTTON}>
              <MagnifyingGlassIcon />
            </Button>
          </RailTooltip>
          {toggle}
        </>
      )}
    </div>
  );
}

const TASK_ROW = "flex items-center gap-2 px-2 font-normal text-foreground/75 transition-colors hover:bg-sidebar-accent/70 hover:text-foreground";

function TaskList({ tasks, slug, tabbable, onNavigate }: { tasks: Task[]; slug: string | null; tabbable: boolean; onNavigate: (href: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const view = visibleTasks(tasks, { expanded, active: slug, limit: TASK_LIMIT });
  return (
    <div className="mt-3 px-2">
      <div className={GROUP_LABEL}>Tasks</div>
      <nav aria-label="Tasks" className="flex flex-col gap-0.5">
        {view.shown.map((task) => (
          <Link key={task.slug} href={taskHref(task.slug)} onClick={() => onNavigate(taskHref(task.slug))} tabIndex={tabbable ? 0 : -1} className={cn(ROW, TASK_ROW)}>
            <StackIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span data-slot="sidebar-task" className="min-w-0 flex-1 truncate">
              {task.slug}
            </span>
            {task.slug === slug && <span aria-label="current task" className="size-1.5 shrink-0 rounded-full bg-brand" />}
          </Link>
        ))}
        {tasks.length > TASK_LIMIT && (
          <button type="button" onClick={() => setExpanded((open) => !open)} tabIndex={tabbable ? 0 : -1} className={cn(ROW, TASK_ROW)}>
            {expanded ? <CaretUpIcon aria-hidden="true" className="size-4 text-muted-foreground" /> : <DotsThreeIcon aria-hidden="true" className="size-4 text-muted-foreground" />}
            {expanded ? "Less" : "More"}
          </button>
        )}
      </nav>
    </div>
  );
}

function SetupRing({ tasks }: { tasks: Task[] | null }) {
  const progress = progressOf(setupSteps(tasks).map((step) => step.done));
  return <ProgressRing value={progress.fraction} size={15} stroke={2} label="Setup progress" />;
}

function SidebarFooter({
  user,
  compact,
  account,
  onSearch,
  onShortcuts,
  settingsHref,
  onNavigate,
}: {
  user: SessionUser | null;
  compact: boolean;
  account: AccountActions;
  onSearch: () => void;
  onShortcuts: () => void;
  settingsHref: string;
  onNavigate: (href: string) => void;
}) {
  return (
    <div className={cn("flex shrink-0 items-center gap-1 border-t border-sidebar-border py-2", compact ? "flex-col px-0" : "px-2")}>
      <UserMenu user={user} compact onSignOut={account.onSignOut} navigate={account.navigate} />
      <span className={cn(!compact && "flex-1")} />
      <RailTooltip label="Settings" side={compact ? "right" : "top"}>
        <Button asChild variant="ghost" className={ICON_BUTTON}>
          <Link href={settingsHref} onClick={() => onNavigate(settingsHref)} aria-label="Settings">
            <GearSixIcon />
          </Link>
        </Button>
      </RailTooltip>
      <HelpMenu onShortcuts={onShortcuts} className={ICON_BUTTON} side={compact ? "right" : "top"} />
      <RailTooltip label="Search  ⌘K" side={compact ? "right" : "top"}>
        <Button variant="ghost" onClick={onSearch} aria-label="Search" className={ICON_BUTTON}>
          <MagnifyingGlassIcon />
        </Button>
      </RailTooltip>
    </div>
  );
}

export function Sidebar({
  user,
  tasks,
  compact = false,
  onSearch,
  onShortcuts = () => {},
  onNavigate,
  onToggle,
  account,
}: {
  user: SessionUser | null;
  tasks: Task[] | null;
  compact?: boolean;
  onSearch: () => void;
  onShortcuts?: () => void;
  onNavigate?: () => void;
  onToggle?: () => void;
  account: AccountActions;
}) {
  const pathname = usePathname() ?? "/tasks";
  const pathSlug = slugFromPath(pathname);
  const slug = pathSlug ?? (tasks && tasks.length === 1 ? tasks[0]!.slug : null);
  const pathSettings = isSettingsPath(pathname);
  const activeSection = pathSlug && !pathSettings ? activeTaskSection(pathname, pathSlug) : null;
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [settingsQuery, setSettingsQuery] = useState("");
  const settingsMode = optimistic ?? pathSettings;

  useEffect(() => {
    if (optimistic !== null && optimistic === pathSettings) setOptimistic(null);
  }, [pathSettings, optimistic]);

  const handleNavigate = (href: string) => {
    setOptimistic(isSettingsPath(href));
    onNavigate?.();
  };

  const groups = pathSlug ? taskNavGroups(pathSlug) : [];
  const groupHrefs = groups.flatMap((group) => group.items.map((item) => item.href));
  const isTaskActive = (href: string) => groups.some((group) => group.items.some((item) => item.href === href && item.key === activeSection));
  const isMainActive = (href: string) =>
    href === "/tasks" ? pathname === "/tasks" : href === GET_STARTED_HREF ? pathname === GET_STARTED_HREF : isTaskActive(href);
  const mainActive = activeHref([GET_STARTED_HREF, ...navHrefs(MAIN_NAV), ...groupHrefs], isMainActive);
  const startEntry: Entry = { key: GET_STARTED_HREF, href: GET_STARTED_HREF, label: "Get started", icon: RocketLaunchIcon, trailing: <SetupRing tasks={tasks} /> };

  const settingsSections = useMemo(() => settingsNav(pathSlug), [pathSlug]);
  const visibleSettings = filterSections(settingsSections, settingsQuery);
  const settingsActive = activeHref(navHrefs(settingsSections), (href) => pathname === href);
  const settingsHref = slug ? taskSettingsHref(slug) : PROFILE_HREF;

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        data-slot="sidebar"
        className="flex h-full flex-col border-r border-sidebar-border bg-sidebar lg:border-r-0"
        style={{ width: compact ? SIDEBAR_RAIL : SIDEBAR_WIDTH }}
      >
        <WorkspaceMenu tasks={tasks} slug={slug} compact={compact} account={account} onSearch={onSearch} onToggle={onToggle} onNavigate={handleNavigate} />
        {!compact && (
          <div className="shrink-0 px-2.5 pt-1 pb-2">
            <Tabs value={settingsMode ? "settings" : "tasks"} onValueChange={(value) => setOptimistic(value === "settings")}>
              <TabsList className="w-full group-data-[orientation=horizontal]/tabs:h-8">
                <TabsTrigger value="tasks" className="text-[13px]">
                  Tasks
                </TabsTrigger>
                <TabsTrigger value="settings" className="text-[13px]">
                  Settings
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        )}

        <div className="relative flex-1 overflow-hidden">
          <div
            className={cn("flex h-full w-[200%] transition-transform duration-250 motion-reduce:transition-none", settingsMode ? "-translate-x-1/2" : "translate-x-0")}
            style={{ transitionTimingFunction: "var(--motion-ease)" }}
          >
            <NavPanelHighlight value={mainActive}>
              <div
                className={cn("w-1/2 overflow-y-auto pb-3 transition-opacity duration-200", settingsMode ? "opacity-0" : "opacity-100")}
                aria-hidden={settingsMode}
                inert={settingsMode || undefined}
              >
                <NavGroup label={null} entries={[startEntry]} isActive={isMainActive} tabbable={!settingsMode} compact={compact} onNavigate={handleNavigate} first />
                {MAIN_NAV.map((section) => (
                  <NavGroup
                    key={section.items[0]!.href}
                    label={section.label}
                    entries={sectionEntries(section)}
                    isActive={isMainActive}
                    tabbable={!settingsMode}
                    compact={compact}
                    onNavigate={handleNavigate}
                    first
                  />
                ))}
                {groups.map((group) => (
                  <NavGroup
                    key={group.label ?? "task"}
                    label={group.label}
                    entries={group.items.map((item) => ({ key: item.key, href: item.href, label: item.label, icon: SECTION_ICONS[item.key] }))}
                    isActive={isTaskActive}
                    tabbable={!settingsMode}
                    compact={compact}
                    onNavigate={handleNavigate}
                  />
                ))}
                {!compact && tasks && tasks.length > 0 && <TaskList tasks={tasks} slug={pathSlug} tabbable={!settingsMode} onNavigate={handleNavigate} />}
              </div>
            </NavPanelHighlight>

            <NavPanelHighlight value={settingsActive}>
              <div
                className={cn("w-1/2 overflow-y-auto pb-3 transition-opacity duration-200", settingsMode ? "opacity-100" : "opacity-0")}
                aria-hidden={!settingsMode}
                inert={!settingsMode || undefined}
              >
                <div className={cn(compact ? "flex justify-center px-0" : "px-2")}>
                  <Link
                    href={pathSlug ? `/tasks/${encodeURIComponent(pathSlug)}` : "/tasks"}
                    onClick={() => handleNavigate("/tasks")}
                    tabIndex={settingsMode ? 0 : -1}
                    aria-label={compact ? "Back" : undefined}
                    className={cn(
                      "flex h-7 items-center rounded-md text-[13px] font-medium text-foreground/75 transition-colors hover:bg-sidebar-accent/70 hover:text-foreground",
                      compact ? "w-7 justify-center px-0" : "gap-2 px-2",
                    )}
                  >
                    <CaretLeftIcon className="size-4 text-muted-foreground" />
                    {!compact && "Back"}
                  </Link>
                </div>
                {!compact && (
                  <div className="mt-1 px-2">
                    <Input
                      value={settingsQuery}
                      onChange={(event) => setSettingsQuery(event.target.value)}
                      placeholder="Find a setting"
                      aria-label="Find a setting"
                      tabIndex={settingsMode ? 0 : -1}
                      className="h-7 bg-background px-2 text-[13px]"
                    />
                  </div>
                )}
                {visibleSettings.map((section) => (
                  <NavGroup
                    key={section.label ?? section.items[0]!.href}
                    label={section.label}
                    entries={sectionEntries(section)}
                    isActive={(href) => pathname === href}
                    tabbable={settingsMode}
                    compact={compact}
                    onNavigate={handleNavigate}
                  />
                ))}
                {visibleSettings.length === 0 && !compact && <p className="px-4 pt-3 text-[12px] text-muted-foreground">No setting matches.</p>}
              </div>
            </NavPanelHighlight>
          </div>
        </div>

        <SidebarFooter
          user={user}
          compact={compact}
          account={account}
          onSearch={onSearch}
          onShortcuts={onShortcuts}
          settingsHref={settingsHref}
          onNavigate={handleNavigate}
        />
      </aside>
    </TooltipProvider>
  );
}
