import { timelineStates, type StepState } from "@modelstill/ui/lib/steps";
import type { Mode } from "./api";

type TaskState = { slug: string; mode: Mode; deferralShare: number | null; lastGatePassed: boolean | null };

export type SetupKey = "task" | "traffic" | "gate" | "serve";
export type SetupStep = { key: SetupKey; label: string; done: boolean };

export function setupSteps(tasks: readonly TaskState[] | null): SetupStep[] {
  const list = tasks ?? [];
  return [
    { key: "task", label: "Define a task", done: list.length > 0 },
    { key: "traffic", label: "Import production history", done: list.some((task) => task.deferralShare !== null) },
    { key: "gate", label: "Gate a student", done: list.some((task) => task.lastGatePassed !== null) },
    { key: "serve", label: "Serve the student", done: list.some((task) => task.mode === "serve") },
  ];
}

export type DataSyncKey = "gateway" | "task" | "history" | "synced";
export type DataSyncStep = { key: DataSyncKey; label: string; state: StepState };

const SYNC_LABELS: Record<DataSyncKey, string> = {
  gateway: "LiteLLM gateway sends traffic",
  task: "Task spec pushed",
  history: "Production history imported",
  synced: "Workspace synced",
};

export function dataSync({ tasks, evalRuns }: { tasks: readonly TaskState[]; evalRuns: number }): DataSyncStep[] {
  const flags = [tasks.some((task) => task.deferralShare !== null), tasks.length > 0, evalRuns > 0];
  const states = timelineStates([...flags, flags.every(Boolean)]);
  return (["gateway", "task", "history", "synced"] as const).map((key, index) => ({ key, label: SYNC_LABELS[key], state: states[index]! }));
}

export const SETUP_INTRO_KEY = "ms_setup_intro_seen";

export function showSetupIntro(tasks: readonly unknown[] | null, dismissed: boolean): boolean {
  return tasks !== null && tasks.length === 0 && !dismissed;
}

export function visibleTasks<T extends { slug: string }>(
  tasks: readonly T[],
  { expanded, active, limit }: { expanded: boolean; active: string | null; limit: number },
): { shown: T[]; hidden: number } {
  if (expanded || tasks.length <= limit) return { shown: [...tasks], hidden: 0 };
  const head = tasks.slice(0, limit);
  const activeTask = active ? tasks.slice(limit).find((task) => task.slug === active) : undefined;
  const shown = activeTask ? [...head, activeTask] : head;
  return { shown, hidden: tasks.length - shown.length };
}
