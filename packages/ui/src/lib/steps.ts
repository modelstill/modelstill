export type StepState = "done" | "current" | "upcoming";

export function stepStates(count: number, current: number): StepState[] {
  return Array.from({ length: count }, (_, index) => (index < current ? "done" : index === current ? "current" : "upcoming"));
}

export function timelineStates(done: readonly boolean[]): StepState[] {
  const current = done.indexOf(false);
  return done.map((finished, index) => (finished ? "done" : index === current ? "current" : "upcoming"));
}

export function progressOf(done: readonly boolean[]): { done: number; total: number; fraction: number } {
  const finished = done.filter(Boolean).length;
  return { done: finished, total: done.length, fraction: done.length === 0 ? 0 : finished / done.length };
}
