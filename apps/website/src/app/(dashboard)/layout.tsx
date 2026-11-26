import type { ReactNode } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/shell";
import { needsOnboarding, ONBOARDING_HOME } from "@/lib/onboarding";
import { currentSession } from "@/lib/server-session";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await currentSession();
  if (session.status === "signed-out") redirect("/login");
  if (session.status === "signed-in" && needsOnboarding(session.user)) redirect(ONBOARDING_HOME);
  return <DashboardShell user={session.status === "signed-in" ? session.user : null}>{children}</DashboardShell>;
}
