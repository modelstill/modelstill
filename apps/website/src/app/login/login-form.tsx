"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { OtpSignIn, type OtpMode } from "@/components/auth/otp-sign-in";
import { apiBaseUrl } from "@/lib/api";
import { otpAuth } from "@/lib/auth-client";
import { pendingAuthorizeUrl, postSignInPath } from "@/lib/oauth-return";

export function LoginForm({ mode = "login" }: { mode?: OtpMode }) {
  const router = useRouter();
  const params = useSearchParams();
  const onSignedIn = () => {
    const authorize = pendingAuthorizeUrl(params, apiBaseUrl());
    if (authorize) {
      window.location.assign(authorize);
      return;
    }
    router.replace(postSignInPath(params));
    router.refresh();
  };
  return <OtpSignIn auth={otpAuth} onSignedIn={onSignedIn} mode={mode} returnedError={params?.get("error") ?? null} />;
}
