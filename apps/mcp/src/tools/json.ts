export function bodyOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function listOf(value: unknown, key: string): unknown[] {
  const list = bodyOf(value)[key];
  return Array.isArray(list) ? list : [];
}

export const TASK_NOT_FOUND = "No task has that slug. Call list_tasks to see every task slug.";
