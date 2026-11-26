export const EMPTY_PAGES = ["tasks", "overview", "evals", "gates", "review", "datasets", "training", "deployment", "traffic", "monitoring"] as const;

export type EmptyPageKey = (typeof EMPTY_PAGES)[number];

export type EmptyPage = {
  key: EmptyPageKey;
  title: string;
  command: string;
  shows: string;
};

function spec(slug: string): string {
  return `tasks/${slug}/spec.yaml`;
}

const PAGES: Record<EmptyPageKey, (slug: string) => Omit<EmptyPage, "key">> = {
  tasks: () => ({
    title: "No tasks yet",
    command: "modelstill push task tasks/<task>/spec.yaml",
    shows: "Every registered task with its serving mode, deferral share and the result of its latest gate.",
  }),
  overview: (slug) => ({
    title: "This task has no versions yet",
    command: `modelstill push task ${spec(slug)}`,
    shows: "The task's deployment, its latest gate with every check, recent training runs and each spec version.",
  }),
  evals: (slug) => ({
    title: "No eval runs yet",
    command: `modelstill push run history.jsonl <run-id> --task ${slug} --primary-metric <metric>`,
    shows: "Each run's score with its 95% interval, and a paired comparison of any two runs case by case.",
  }),
  gates: (slug) => ({
    title: "No gate has run yet",
    command: `modelstill push gate history.jsonl <run-id> --task ${slug} --spec ${spec(slug)} --previous <baseline-run> --flip-rate 1 --cost-ratio 9 --p95-latency-ms 99999`,
    shows: "Every gate decision with each threshold, measured value and interval. Replace a worst-case value only with one you measured.",
  }),
  review: (slug) => ({
    title: "The review queue is empty",
    command: `modelstill push review dataset.jsonl --task ${slug}`,
    shows: "Items where the two teachers disagreed, side by side, to accept or correct before they become training data.",
  }),
  datasets: (slug) => ({
    title: "No dataset items yet",
    command: `modelstill push review dataset.jsonl --task ${slug}`,
    shows: "Every labelled item of the task with its review state and the answer a reviewer accepted or corrected, which is what training reads.",
  }),
  deployment: (slug) => ({
    title: "Not deployed yet",
    command: `modelstill serve calibrate calib.jsonl --target-error 0.05 --deployment ${slug}.deployment.yaml`,
    shows: "How the gateway routes this task: the serving mode, the student model, the confidence threshold below which a call goes to the cloud, and the shadow sample.",
  }),
  training: (slug) => ({
    title: "No training runs yet",
    command: `modelstill train run ${spec(slug)} --train train.jsonl --val val.jsonl --seed 1 --backend remote --host <gpu-host> --gpus 0`,
    shows: "Each run's loss, eval loss and reward by step while it trains, then its final metrics and attestation.",
  }),
  traffic: (slug) => ({
    title: "No traffic in this window",
    command: `modelstill serve calibrate calib.jsonl --target-error 0.05 --deployment ${slug}.deployment.yaml`,
    shows: "Hourly calls served by the student or deferred to the cloud, mismatches and p95 latency, once the gateway runs the task in shadow mode.",
  }),
  monitoring: (slug) => ({
    title: "No canary has run yet",
    command: `modelstill monitor canary tasks/${slug}/monitor.yaml --fail-on-alert`,
    shows: "Canary pass rates per provider with exact intervals, and alerts when a provider drifts or a canary drops.",
  }),
};

export function emptyPage(key: EmptyPageKey, slug: string): EmptyPage {
  return { key, ...PAGES[key](slug) };
}
