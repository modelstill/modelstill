import { notFound } from "next/navigation";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { mcpUrl } from "@/lib/mcp";
import { ONBOARDING_STEPS, type OnboardingStepKey } from "@/lib/onboarding";
import { currentSession } from "@/lib/server-session";

export default async function OnboardingStepPage({ params }: { params: Promise<{ step: string }> }) {
  const { step } = await params;
  const known = ONBOARDING_STEPS.find((candidate) => candidate.key === step);
  if (!known) notFound();
  const session = await currentSession();
  return <OnboardingFlow step={known.key as OnboardingStepKey} user={session.status === "signed-in" ? session.user : null} mcpUrl={mcpUrl()} />;
}
