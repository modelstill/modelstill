import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthSplit } from "@/components/auth/auth-split";
import { currentSession } from "@/lib/server-session";
import { ConsentForm } from "./consent-form";

export const metadata: Metadata = { title: "Allow access" };

export const dynamic = "force-dynamic";

export default async function ConsentPage() {
  const session = await currentSession();
  if (session.status === "signed-out") redirect("/login");
  return (
    <AuthSplit
      title="Allow access."
      subtitle={session.status === "signed-in" ? `Signed in as ${session.user.email}` : "Review what this client can do"}
    >
      <Suspense fallback={null}>
        <ConsentForm />
      </Suspense>
    </AuthSplit>
  );
}
