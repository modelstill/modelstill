import type { ReactNode } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Toaster } from "@modelstill/ui/components/sonner";
import { OnboardingProvider } from "@/components/onboarding/onboarding-state";
import { currentSession } from "@/lib/server-session";

export const metadata: Metadata = {
  title: "Get started",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  const session = await currentSession();
  if (session.status === "signed-out") redirect("/login?next=/onboarding");
  return (
    <OnboardingProvider>
      {children}
      <Toaster position="bottom-right" />
    </OnboardingProvider>
  );
}
