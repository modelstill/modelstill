import { SIGNED_IN_HOME } from "./oauth-return";
import type { SessionUser } from "./session";

export type OnboardingStepKey = "profile" | "task" | "key" | "connect" | "data" | "done";

export type OnboardingStep = { key: OnboardingStepKey; label: string; href: string };

export const ONBOARDING_HOME = "/onboarding";

export const ONBOARDING_STEPS: OnboardingStep[] = [
  { key: "profile", label: "About you", href: "/onboarding/profile" },
  { key: "task", label: "Your first task", href: "/onboarding/task" },
  { key: "key", label: "API key", href: "/onboarding/key" },
  { key: "connect", label: "Coding agent", href: "/onboarding/connect" },
  { key: "data", label: "Your data", href: "/onboarding/data" },
  { key: "done", label: "Done", href: "/onboarding/done" },
];

export type OnboardingPosition = OnboardingStep & { number: number; total: number; next: string; back: string | null };

export function onboardingStep(key: OnboardingStepKey): OnboardingPosition {
  const index = ONBOARDING_STEPS.findIndex((step) => step.key === key);
  const step = ONBOARDING_STEPS[index]!;
  return {
    ...step,
    number: index + 1,
    total: ONBOARDING_STEPS.length,
    next: ONBOARDING_STEPS[index + 1]?.href ?? SIGNED_IN_HOME,
    back: ONBOARDING_STEPS[index - 1]?.href ?? null,
  };
}

export function needsOnboarding(user: SessionUser): boolean {
  return !user.onboardedAt;
}

export function suggestedName(user: Pick<SessionUser, "name" | "email">): string {
  return user.name.trim();
}

export type OnboardingGoal = "extract" | "classify" | "tag" | "judge";

export type Goal = { id: OnboardingGoal; label: string; slug: string; instruction: string; art: string };

export const GOALS: Goal[] = [
  {
    id: "extract",
    label: "Pull fields out of text",
    slug: "invoice-fields",
    instruction: "Every field the schema names, copied exactly as the document states it.",
    art: "dash-art-still",
  },
  {
    id: "classify",
    label: "Classify or route requests",
    slug: "ticket-router",
    instruction: "The one queue that should own the ticket, from the fixed list.",
    art: "dash-art-sky",
  },
  {
    id: "tag",
    label: "Tag entities in documents",
    slug: "technographics",
    instruction: "Every named technology in the posting, merged by canonical product.",
    art: "dash-art-sea",
  },
  {
    id: "judge",
    label: "Score or judge answers",
    slug: "answer-grader",
    instruction: "Whether the answer is supported by the cited passage, as yes or no.",
    art: "dash-art-sun",
  },
];

export function onboardingGoal(value: string | null | undefined): OnboardingGoal {
  return GOALS.find((goal) => goal.id === value)?.id ?? "extract";
}

export function goalFor(id: OnboardingGoal): Goal {
  return GOALS.find((goal) => goal.id === id)!;
}

export function specSample(id: OnboardingGoal): string {
  const goal = goalFor(id);
  return [
    `task: ${goal.slug}`,
    "version: 1",
    "instruction: prompts/system.md",
    "output_schema: schemas/out.json",
    "requirements:",
    "  - id: correct_output",
    "    priority: p0",
    `    instruction: ${goal.instruction}`,
    "labelling:",
    "  teachers:",
    "    - {model: deepseek/deepseek-v4-flash, family: deepseek}",
    "    - {model: qwen/qwen3.7-flash, family: qwen}",
    "  disagreement: human_queue",
    "eval:",
    "  judge: {model: google/gemma-4-27b-it, family: gemma}",
    "  gate:",
    "    metric: correct_output",
    "    max_regression: 0.02",
    "    max_cost_ratio: 0.60",
    "train:",
    "  base: Qwen/Qwen3-1.7B",
    "  method: lora",
    "  seeds: [1, 2, 3]",
  ].join("\n");
}

export function pushCommands(slug: string): string[] {
  const spec = `tasks/${slug}/spec.yaml`;
  return [`modelstill spec validate ${spec}`, `MODELSTILL_API_TOKEN=$MODELSTILL_API_KEY modelstill push task ${spec}`];
}
