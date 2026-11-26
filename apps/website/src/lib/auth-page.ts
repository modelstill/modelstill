import { redirect } from "next/navigation";
import { apiBaseUrl } from "./api";
import { pendingAuthorizeUrl, postSignInPath } from "./oauth-return";
import { needsOnboarding, ONBOARDING_HOME } from "./onboarding";
import { currentSession } from "./server-session";
import type { SessionState } from "./session";

export type RawSearchParams = Record<string, string | string[] | undefined>;

export function toParams(raw: RawSearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, entry);
  }
  return params;
}

export function signedInDestination(session: SessionState, params: URLSearchParams, apiUrl: string): string | null {
  if (session.status !== "signed-in") return null;
  const authorize = pendingAuthorizeUrl(params, apiUrl);
  if (authorize) return authorize;
  return needsOnboarding(session.user) ? ONBOARDING_HOME : postSignInPath(params);
}

export async function redirectIfSignedIn(params: URLSearchParams): Promise<void> {
  const destination = signedInDestination(await currentSession(), params, apiBaseUrl());
  if (destination) redirect(destination);
}
