import { timingSafeEqual } from "node:crypto";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { Auth } from "./index.ts";
import { READ_SCOPE, WRITE_SCOPE, oauthAccess, scopeList } from "./oauth-scopes.ts";
import { API_KEY_PREFIX, keyAccess } from "./permissions.ts";

export type AuthType = "token" | "session" | "api_key" | "oauth";

export type Caller = {
  authType: AuthType;
  userId: string | null;
  email?: string;
  canRead: boolean;
  canWrite: boolean;
  apiKeyId?: string;
  scopes?: string[];
};

export type CallerVariables = { caller: Caller };

export function bearerOf(header: string | null | undefined): string | null {
  if (!header || !/^bearer /i.test(header)) return null;
  return header.slice("bearer ".length).trim() || null;
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function apiKeyCaller(auth: Auth, key: string): Promise<Caller | null> {
  const verified = await auth.api.verifyApiKey({ body: { key } }).catch(() => null);
  if (!verified?.valid || !verified.key) return null;
  return {
    authType: "api_key",
    userId: verified.key.referenceId,
    apiKeyId: verified.key.id,
    ...keyAccess(verified.key.permissions),
  };
}

async function oauthCaller(auth: Auth, headers: Headers): Promise<Caller | null> {
  const token = await auth.api.getMcpSession({ headers }).catch(() => null);
  if (!token?.userId) return null;
  return { authType: "oauth", userId: token.userId, scopes: scopeList(token.scopes), ...oauthAccess(token.scopes) };
}

async function sessionCaller(auth: Auth, headers: Headers): Promise<Caller | null> {
  const session = await auth.api.getSession({ headers }).catch(() => null);
  if (!session?.user?.id) return null;
  return { authType: "session", userId: session.user.id, email: session.user.email, canRead: true, canWrite: true };
}

export async function resolveCaller(auth: Auth, apiToken: string | undefined, headers: Headers): Promise<Caller | null> {
  const bearer = bearerOf(headers.get("authorization"));
  if (bearer && apiToken && sameSecret(bearer, apiToken)) {
    return { authType: "token", userId: null, canRead: true, canWrite: true };
  }
  const key = headers.get("x-api-key") ?? (bearer?.startsWith(API_KEY_PREFIX) ? bearer : null);
  if (key) return apiKeyCaller(auth, key);
  if (bearer) return oauthCaller(auth, headers);
  return sessionCaller(auth, headers);
}

export class InsufficientScope extends HTTPException {
  readonly scope: string;

  constructor(scope: string) {
    super(403, { message: "forbidden" });
    this.scope = scope;
  }
}

function refuse(caller: Caller, need: "read" | "write"): never {
  if (caller.authType === "oauth") throw new InsufficientScope(need === "write" ? WRITE_SCOPE : READ_SCOPE);
  throw new HTTPException(403, { message: "forbidden" });
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function requireCaller(auth: Auth, apiToken: string | undefined) {
  return createMiddleware<{ Variables: CallerVariables }>(async (c, next) => {
    const caller = await resolveCaller(auth, apiToken, c.req.raw.headers);
    if (!caller) throw new HTTPException(401, { message: "unauthorized" });
    if (!caller.canRead) refuse(caller, "read");
    if (!READ_METHODS.has(c.req.method) && !caller.canWrite) refuse(caller, "write");
    c.set("caller", caller);
    await next();
  });
}
