import { Suspense } from "react";
import type { Metadata } from "next";
import { AuthSplit } from "@/components/auth/auth-split";
import { AuthSwitchLink } from "@/components/auth/auth-switch-link";
import { redirectIfSignedIn, toParams, type RawSearchParams } from "@/lib/auth-page";
import { LoginForm } from "../login/login-form";

export const metadata: Metadata = {
  title: "Create your account",
  description: "Create a ModelStill account and distil your first task.",
};

export const dynamic = "force-dynamic";

export default async function SignupPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const params = toParams(await searchParams);
  await redirectIfSignedIn(params);
  return (
    <AuthSplit
      title="Own the model behind your task."
      subtitle="Create your account with a one-time code. No password, no card."
    >
      <Suspense fallback={null}>
        <LoginForm mode="signup" />
      </Suspense>

      <p className="mt-8 text-[14px] text-muted-foreground">
        Already have an account?{" "}
        <Suspense fallback={<span className="font-medium text-link">Log in &rarr;</span>}>
          <AuthSwitchLink to="/login">Log in &rarr;</AuthSwitchLink>
        </Suspense>
      </p>
    </AuthSplit>
  );
}
