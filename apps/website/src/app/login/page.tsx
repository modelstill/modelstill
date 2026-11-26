import { Suspense } from "react";
import type { Metadata } from "next";
import { AuthSplit } from "@/components/auth/auth-split";
import { AuthSwitchLink } from "@/components/auth/auth-switch-link";
import { redirectIfSignedIn, toParams, type RawSearchParams } from "@/lib/auth-page";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your ModelStill account.",
};

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const params = toParams(await searchParams);
  await redirectIfSignedIn(params);
  const forMcp = params.has("client_id");
  return (
    <AuthSplit
      title={forMcp ? "Sign in to connect." : "Welcome back."}
      subtitle={
        forMcp
          ? "An MCP client wants to use ModelStill. Enter your email and we'll send you a one-time sign-in code."
          : "Enter your email and we'll send you a one-time sign-in code."
      }
    >
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>

      <p className="mt-8 text-[14px] text-muted-foreground">
        Don&rsquo;t have an account?{" "}
        <Suspense fallback={<span className="font-medium text-link">Create one &rarr;</span>}>
          <AuthSwitchLink to="/signup">Create one &rarr;</AuthSwitchLink>
        </Suspense>
      </p>
    </AuthSplit>
  );
}
