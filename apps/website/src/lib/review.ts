export type ReviewSummary = { total: number; pending: number; decided: number };

const WAITING = new Set(["pending", "queued"]);

export function isWaiting(state: string): boolean {
  return WAITING.has(state);
}

export function reviewSummary(items: readonly { reviewState: string }[]): ReviewSummary {
  const pending = items.filter((item) => isWaiting(item.reviewState)).length;
  return { total: items.length, pending, decided: items.length - pending };
}
