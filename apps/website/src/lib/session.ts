export type SessionUser = { id: string; email: string; name: string; onboardedAt: string | null };

export type SessionState = { status: "signed-in"; user: SessionUser } | { status: "signed-out" } | { status: "unreachable" };

type SessionBody = { user?: { id?: string; email?: string; name?: string | null; onboardedAt?: string | null } } | null;

export async function readSession({
  apiUrl,
  cookie,
  fetchImpl = fetch,
}: {
  apiUrl: string;
  cookie: string;
  fetchImpl?: typeof fetch;
}): Promise<SessionState> {
  if (!cookie) return { status: "signed-out" };
  let response: Response;
  try {
    response = await fetchImpl(`${apiUrl.replace(/\/+$/, "")}/api/auth/get-session`, {
      headers: { cookie, accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    return { status: "unreachable" };
  }
  if (response.status >= 500) return { status: "unreachable" };
  const body = (await response.json().catch(() => null)) as SessionBody;
  const user = body?.user;
  if (!response.ok || !user?.id || !user.email) return { status: "signed-out" };
  return { status: "signed-in", user: { id: user.id, email: user.email, name: user.name ?? "", onboardedAt: user.onboardedAt ?? null } };
}
