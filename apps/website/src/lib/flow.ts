import type { ComparedCase, Mode, ReviewCandidate } from "./api";
import type { TaskSectionKey } from "./nav";

type RunLabel = { model: string } | null;

function label(side: "before" | "after", run: RunLabel): string {
  return run ? `${side} (${run.model})` : side;
}

export function reviewCandidate(detail: ComparedCase, before: RunLabel, after: RunLabel): ReviewCandidate {
  return {
    inputHash: detail.inputHash,
    input: detail.input,
    outputs: { [label("before", before)]: detail.before.output, [label("after", after)]: detail.after.output },
  };
}

export function latestPair(runs: readonly { id: string; createdAt: string }[]): { before: string; after: string } | null {
  if (runs.length < 2) return null;
  const [newest, previous] = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { before: previous!.id, after: newest!.id };
}

export type DatasetCounts = { all: number; none: number; queued: number; accepted: number; corrected: number };

export function datasetCounts(items: readonly { reviewState: string }[]): DatasetCounts {
  const count = (state: string) => items.filter((item) => item.reviewState === state).length;
  return { all: items.length, none: count("none"), queued: count("queued"), accepted: count("accepted"), corrected: count("corrected") };
}

export function labelledCount(items: readonly { reviewState: string }[]): number {
  return items.filter((item) => item.reviewState === "accepted" || item.reviewState === "corrected").length;
}

export function stepIndex(current: number | null, delta: 1 | -1, length: number): number | null {
  if (length === 0) return null;
  if (current === null) return 0;
  return Math.min(Math.max(current + delta, 0), length - 1);
}

export type FlowState = {
  evalRuns: number;
  pendingReview: number;
  labelled: number;
  trainRuns: number;
  lastGatePassed: boolean | null;
  mode: Mode;
};

export function nextStep(state: FlowState): TaskSectionKey {
  if (state.evalRuns === 0) return "evals";
  if (state.pendingReview > 0) return "review";
  if (state.trainRuns === 0) return state.labelled > 0 ? "training" : "evals";
  if (state.lastGatePassed !== true) return "gates";
  return state.mode === "off" ? "deployment" : "traffic";
}
