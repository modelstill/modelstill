"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LinkProvider } from "@modelstill/ui/blocks/link";
import { Toaster } from "@modelstill/ui/components/sonner";
import { cn } from "@modelstill/ui/lib/utils";
import { signOut } from "@/lib/auth-client";
import { GET_STARTED_HREF, slugFromPath } from "@/lib/nav";
import { isTypingTarget, resolveKey } from "@/lib/shortcuts";
import { Fade } from "@/components/motion/fade";
import { FADE } from "@/lib/motion";
import { APP_THEME } from "@/lib/theme";
import type { SessionUser } from "@/lib/session";
import { useResource } from "@/lib/use-api";
import { CommandPalette } from "./command-palette";
import { PageActionsProvider } from "./page-actions";
import { FirstRunIntro } from "./setup-intro";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import type { AccountActions } from "./user-menu";

export { PageBody } from "@modelstill/ui/blocks/section";

const DESKTOP = "(min-width: 1024px)";
const SIDEBAR_KEY = "ms_sidebar";

function useGlobalShortcuts({ slug, onGo, onHelp, onSidebar }: { slug: string | null; onGo: (href: string) => void; onHelp: () => void; onSidebar: () => void }) {
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      if (isTypingTarget(event.target) || document.querySelector("[role=dialog]")) return;
      const result = resolveKey(pending.current, event.key, slug);
      pending.current = result.pending;
      if (timer.current) clearTimeout(timer.current);
      if (result.pending) timer.current = setTimeout(() => (pending.current = null), 1200);
      if (!result.action) return;
      event.preventDefault();
      if (result.action.type === "go") onGo(result.action.href);
      else if (result.action.type === "help") onHelp();
      else onSidebar();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [slug, onGo, onHelp, onSidebar]);
}

export function DashboardShell({ user, children }: { user: SessionUser | null; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? "/tasks";
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const tasks = useResource((api) => api.listTasks(), []);
  const taskList = tasks.status === "ready" ? tasks.data : tasks.status === "error" ? [] : null;
  const slug = slugFromPath(pathname);

  useEffect(() => {
    if (window.matchMedia(DESKTOP).matches) setCollapsed(window.localStorage.getItem(SIDEBAR_KEY) === "closed");
  }, []);

  const toggle = useCallback(() => {
    if (window.matchMedia(DESKTOP).matches) {
      setCollapsed((previous) => {
        window.localStorage.setItem(SIDEBAR_KEY, previous ? "open" : "closed");
        return !previous;
      });
    } else {
      setDrawerOpen((previous) => !previous);
    }
  }, []);

  const go = useCallback((href: string) => router.push(href), [router]);
  const showHelp = useCallback(() => setHelpOpen(true), []);
  useGlobalShortcuts({ slug, onGo: go, onHelp: showHelp, onSidebar: toggle });

  const account = useMemo<AccountActions>(
    () => ({
      onSignOut: signOut,
      navigate: (href) => {
        if (href === "/login") window.location.assign(href);
        else router.push(href);
      },
    }),
    [router],
  );

  const closeDrawer = () => setDrawerOpen(false);
  const compactNav = collapsed && !drawerOpen;

  return (
    <LinkProvider component={Link}>
      <PageActionsProvider>
        <div className="flex h-dvh overflow-hidden bg-sidebar text-[14px] text-foreground">
          {drawerOpen && <button type="button" aria-label="Close sidebar" onClick={closeDrawer} className="fixed inset-0 z-30 bg-foreground/30 lg:hidden" />}

          <div
            className={cn(
              "fixed inset-y-0 left-0 z-40 w-[224px] shrink-0 transition-transform duration-200 ease-[var(--motion-ease)] motion-reduce:transition-none lg:static lg:translate-x-0 lg:transition-[width]",
              drawerOpen ? "translate-x-0" : "-translate-x-full",
              collapsed && "lg:w-[52px]",
            )}
          >
            <Sidebar
              user={user}
              tasks={taskList}
              compact={compactNav}
              onSearch={() => setCmdOpen(true)}
              onShortcuts={showHelp}
              onNavigate={closeDrawer}
              onToggle={toggle}
              account={account}
            />
          </div>

          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <Topbar onToggle={toggle} tasks={taskList} />
            <main
              id="main"
              tabIndex={-1}
              data-slot="content-panel"
              className="flex min-h-0 flex-1 flex-col overflow-y-auto border-t border-border bg-background outline-none lg:mr-2 lg:mb-2 lg:rounded-md lg:border"
            >
              <Fade key={pathname} data-slot="page-enter" transition={FADE} className="flex min-h-0 min-w-0 flex-1 flex-col">
                {children}
              </Fade>
            </main>
          </div>

          <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} tasks={taskList} slug={slug} account={account} onShortcuts={showHelp} />
          <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
          <FirstRunIntro tasks={taskList} onExplore={() => router.push(GET_STARTED_HREF)} />
          <Toaster theme={APP_THEME} position="bottom-right" richColors />
        </div>
      </PageActionsProvider>
    </LinkProvider>
  );
}
