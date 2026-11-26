export type TaskSectionKey =
  | "overview"
  | "traffic"
  | "monitoring"
  | "evals"
  | "review"
  | "datasets"
  | "gates"
  | "training"
  | "deployment";

export type TaskSection = { key: TaskSectionKey; label: string; href: string };

const SECTIONS: { key: TaskSectionKey; label: string; path: string }[] = [
  { key: "overview", label: "Overview", path: "" },
  { key: "traffic", label: "Traffic", path: "/traffic" },
  { key: "monitoring", label: "Monitoring", path: "/monitoring" },
  { key: "evals", label: "Evals", path: "/evals" },
  { key: "review", label: "Review", path: "/review" },
  { key: "datasets", label: "Datasets", path: "/datasets" },
  { key: "gates", label: "Gates", path: "/gates" },
  { key: "training", label: "Training", path: "/training" },
  { key: "deployment", label: "Deployment", path: "/deployment" },
];

export type TaskGroupLabel = "Observe" | "Evaluate" | "Improve";

const TASK_GROUPS: { label: TaskGroupLabel | null; keys: TaskSectionKey[] }[] = [
  { label: null, keys: ["overview"] },
  { label: "Observe", keys: ["traffic", "monitoring"] },
  { label: "Evaluate", keys: ["evals", "review", "datasets", "gates"] },
  { label: "Improve", keys: ["training", "deployment"] },
];

export function taskHref(slug: string): string {
  return `/tasks/${encodeURIComponent(slug)}`;
}

export function taskSections(slug: string): TaskSection[] {
  return SECTIONS.map((s) => ({ key: s.key, label: s.label, href: `${taskHref(slug)}${s.path}` }));
}

export function taskSectionHref(slug: string, key: TaskSectionKey): string {
  return taskSections(slug).find((section) => section.key === key)!.href;
}

export type TaskNavGroup = { label: TaskGroupLabel | null; items: TaskSection[] };

export function taskNavGroups(slug: string): TaskNavGroup[] {
  const sections = taskSections(slug);
  return TASK_GROUPS.map((group) => ({
    label: group.label,
    items: group.keys.map((key) => sections.find((section) => section.key === key)!),
  }));
}

export function slugFromPath(pathname: string): string | null {
  const match = /^\/tasks\/([^/]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1]!) : null;
}

export function activeTaskSection(pathname: string, slug: string): TaskSectionKey {
  const matches = taskSections(slug).filter((s) => pathname === s.href || pathname.startsWith(`${s.href}/`));
  return matches.sort((a, b) => b.href.length - a.href.length)[0]?.key ?? "overview";
}

export type CompareFilter = { metric: string; direction: "improved" | "regressed" };

export function compareHref(slug: string, before: string, after: string, filter?: CompareFilter): string {
  const params = new URLSearchParams({ before, after });
  if (filter) {
    params.set("metric", filter.metric);
    params.set("change", filter.direction);
  }
  return `${taskHref(slug)}/evals/compare?${params.toString()}`;
}

export function evalRunHref(slug: string, id: string): string {
  return `${taskHref(slug)}/evals/${encodeURIComponent(id)}`;
}

function evalRunId(pathname: string): string | null {
  const match = /^\/tasks\/[^/]+\/evals\/([^/]+)\/?$/.exec(pathname);
  if (!match || match[1] === "compare") return null;
  return decodeURIComponent(match[1]!);
}

export function gateReportHref(slug: string, id: string): string {
  return `${taskHref(slug)}/gates/${encodeURIComponent(id)}`;
}

function gateReportId(pathname: string): string | null {
  const match = /^\/tasks\/[^/]+\/gates\/([^/]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1]!) : null;
}

export function trainRunHref(slug: string, key: string): string {
  return `${taskHref(slug)}/training/${encodeURIComponent(key)}`;
}

export function taskSettingsHref(slug: string): string {
  return `${taskHref(slug)}/settings`;
}

function trainRunKey(pathname: string): string | null {
  const match = /^\/tasks\/[^/]+\/training\/([^/]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1]!) : null;
}

export type Crumb = { label: string; href?: string };

export const API_KEYS_HREF = "/settings/api-keys";
export const SETTINGS_PREFIX = "/settings";
export const CONNECT_HREF = "/settings/mcp";
export const PROFILE_HREF = "/settings/profile";
export const GET_STARTED_HREF = "/get-started";

export type PageSection = TaskSectionKey | "tasks" | "settings";

function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isTaskSettingsPath(pathname: string): boolean {
  return /^\/tasks\/[^/]+\/settings(\/|$)/.test(pathname);
}

export function isSettingsPath(pathname: string): boolean {
  return under(pathname, SETTINGS_PREFIX) || isTaskSettingsPath(pathname);
}

export function sectionForPath(pathname: string): PageSection {
  if (isSettingsPath(pathname)) return "settings";
  const slug = slugFromPath(pathname);
  return slug ? activeTaskSection(pathname, slug) : "tasks";
}

const SETTINGS_CRUMBS: [string, string][] = [
  [PROFILE_HREF, "Profile"],
  [CONNECT_HREF, "Connect via MCP"],
  [API_KEYS_HREF, "API keys"],
];

function lastIsPage(list: Crumb[]): Crumb[] {
  const last = list[list.length - 1]!;
  return [...list.slice(0, -1), { label: last.label }];
}

export function breadcrumbs(pathname: string): Crumb[] {
  if (under(pathname, GET_STARTED_HREF)) return [{ label: "Get started" }];
  if (under(pathname, SETTINGS_PREFIX)) {
    const page = SETTINGS_CRUMBS.find(([href]) => under(pathname, href))?.[1] ?? "API keys";
    return [{ label: "Settings" }, { label: page }];
  }
  const slug = slugFromPath(pathname);
  if (!slug) return [{ label: "Tasks" }];
  const list: Crumb[] = [
    { label: "Tasks", href: "/tasks" },
    { label: slug, href: taskHref(slug) },
  ];
  if (isTaskSettingsPath(pathname)) return lastIsPage([...list, { label: "Settings" }]);
  const section = activeTaskSection(pathname, slug);
  if (section !== "overview") {
    const entry = taskSections(slug).find((candidate) => candidate.key === section)!;
    list.push({ label: entry.label, href: entry.href });
  }
  if (pathname.endsWith("/evals/compare")) list.push({ label: "Compare" });
  const runId = evalRunId(pathname);
  if (runId) list.push({ label: `Run ${runId.slice(0, 8)}` });
  const gateId = gateReportId(pathname);
  if (gateId) list.push({ label: `Report ${gateId.slice(0, 8)}` });
  const runKey = trainRunKey(pathname);
  if (runKey) list.push({ label: runKey });
  return lastIsPage(list);
}

export type NavKey = "tasks" | "connect" | "api-keys" | "profile" | "task-settings";

export type NavItem = { key: NavKey; label: string; href: string };

export type NavSection = { label: string | null; items: NavItem[] };

const ITEMS: Record<Exclude<NavKey, "task-settings">, NavItem> = {
  tasks: { key: "tasks", label: "Tasks", href: "/tasks" },
  connect: { key: "connect", label: "Connect via MCP", href: CONNECT_HREF },
  "api-keys": { key: "api-keys", label: "API keys", href: API_KEYS_HREF },
  profile: { key: "profile", label: "Profile", href: PROFILE_HREF },
};

export const MAIN_NAV: NavSection[] = [{ label: null, items: [ITEMS.tasks] }];

const ACCOUNT_SETTINGS: NavSection[] = [
  { label: "Account", items: [ITEMS.profile] },
  { label: "Developers", items: [ITEMS["api-keys"], ITEMS.connect] },
];

export function settingsNav(slug: string | null): NavSection[] {
  if (!slug) return ACCOUNT_SETTINGS;
  return [{ label: "Task", items: [{ key: "task-settings", label: "General", href: taskSettingsHref(slug) }] }, ...ACCOUNT_SETTINGS];
}

export const SETTINGS_NAV: NavSection[] = settingsNav(null);

export function activeHref(hrefs: readonly string[], isActive: (href: string) => boolean): string | null {
  return hrefs.find(isActive) ?? null;
}
