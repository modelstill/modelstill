import { PROFILE_HREF, taskSectionHref, taskSettingsHref, type TaskSectionKey } from "./nav";

export type ShortcutAction = { type: "go"; href: string } | { type: "help" } | { type: "sidebar" };

export type KeyResult = { pending: string | null; action: ShortcutAction | null };

const GO_PREFIX = "g";

export const TASK_GO_KEYS: Record<string, TaskSectionKey> = {
  o: "overview",
  t: "traffic",
  m: "monitoring",
  e: "evals",
  r: "review",
  d: "datasets",
  g: "gates",
  n: "training",
  p: "deployment",
};

const NONE: KeyResult = { pending: null, action: null };

function goTarget(key: string, slug: string | null): string | null {
  if (key === "l") return "/tasks";
  if (key === "s") return slug ? taskSettingsHref(slug) : PROFILE_HREF;
  const section = TASK_GO_KEYS[key];
  return section && slug ? taskSectionHref(slug, section) : null;
}

export function resolveKey(pending: string | null, key: string, slug: string | null): KeyResult {
  if (pending === GO_PREFIX) {
    const href = goTarget(key.toLowerCase(), slug);
    return href ? { pending: null, action: { type: "go", href } } : NONE;
  }
  if (key === GO_PREFIX) return { pending: GO_PREFIX, action: null };
  if (key === "?") return { pending: null, action: { type: "help" } };
  if (key === "[") return { pending: null, action: { type: "sidebar" } };
  return NONE;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  const editable = target.getAttribute("contenteditable");
  return editable !== null && editable !== "false";
}

export type ShortcutItem = { keys: string[]; label: string };

export type ShortcutGroup = { label: string; items: ShortcutItem[] };

const TASK_PAGE_LABELS: Record<TaskSectionKey, string> = {
  overview: "Task overview",
  traffic: "Traffic",
  monitoring: "Monitoring",
  evals: "Evals",
  review: "Review queue",
  datasets: "Datasets",
  gates: "Gates",
  training: "Training runs",
  deployment: "Deployment",
};

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    label: "Anywhere",
    items: [
      { keys: ["⌘", "K"], label: "Search pages, tasks and actions" },
      { keys: ["?"], label: "Show keyboard shortcuts" },
      { keys: ["["], label: "Collapse or expand the sidebar" },
      { keys: ["G", "L"], label: "Task list" },
      { keys: ["G", "S"], label: "Settings" },
    ],
  },
  {
    label: "Go to a page of the open task",
    items: Object.entries(TASK_GO_KEYS).map(([key, section]) => ({ keys: ["G", key.toUpperCase()], label: TASK_PAGE_LABELS[section] })),
  },
  {
    label: "Review queue",
    items: [
      { keys: ["J"], label: "Next item" },
      { keys: ["K"], label: "Previous item" },
    ],
  },
  {
    label: "Compare runs",
    items: [
      { keys: ["J"], label: "Next case" },
      { keys: ["K"], label: "Previous case" },
    ],
  },
];

export function goKeysFor(section: TaskSectionKey): string[] | null {
  const entry = Object.entries(TASK_GO_KEYS).find(([, value]) => value === section);
  return entry ? ["G", entry[0].toUpperCase()] : null;
}
