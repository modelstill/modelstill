import { redirect } from "next/navigation";
import { ONBOARDING_STEPS } from "@/lib/onboarding";

export default function OnboardingPage() {
  redirect(ONBOARDING_STEPS[0]!.href);
}
