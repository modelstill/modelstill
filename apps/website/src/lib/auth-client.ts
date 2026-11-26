"use client";

import { apiKeyClient } from "@better-auth/api-key/client";
import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import type { OtpAuth } from "@/components/auth/otp-sign-in";
import { apiBaseUrl } from "./api";

export const authClient = createAuthClient({
  baseURL: apiBaseUrl(),
  fetchOptions: { credentials: "include" },
  plugins: [emailOTPClient(), apiKeyClient()],
});

export const otpAuth: OtpAuth = {
  sendCode: (email) => authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" }),
  verify: (email, code) => authClient.signIn.emailOtp({ email, otp: code }),
};

export async function decideConsent(consentCode: string, accept: boolean): Promise<string> {
  const response = await fetch(`${apiBaseUrl()}/api/auth/oauth2/consent`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accept, consent_code: consentCode }),
  });
  const body = (await response.json().catch(() => null)) as { redirectURI?: string; error_description?: string; message?: string } | null;
  if (!response.ok || !body?.redirectURI) throw new Error(body?.error_description ?? body?.message ?? `HTTP ${response.status}`);
  return body.redirectURI;
}

export async function signOut(): Promise<void> {
  await authClient.signOut();
}
