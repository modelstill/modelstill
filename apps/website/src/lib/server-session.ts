import { headers } from "next/headers";
import { apiBaseUrl } from "./api";
import { readSession, type SessionState } from "./session";

export function serverApiUrl(): string {
  return process.env.API_INTERNAL_URL || apiBaseUrl();
}

export async function currentSession(): Promise<SessionState> {
  const cookie = (await headers()).get("cookie") ?? "";
  return readSession({ apiUrl: serverApiUrl(), cookie });
}
