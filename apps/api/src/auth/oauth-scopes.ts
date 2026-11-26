export const READ_SCOPE = "modelstill:read";
export const WRITE_SCOPE = "modelstill:write";

export const MODELSTILL_SCOPES = [READ_SCOPE, WRITE_SCOPE] as const;

export const OAUTH_SCOPES = ["openid", "profile", "email", "offline_access", ...MODELSTILL_SCOPES] as const;

export function scopeList(scopes: string | null | undefined): string[] {
  return (scopes ?? "").split(/\s+/).filter(Boolean);
}

export function oauthAccess(scopes: string | null | undefined): { canRead: boolean; canWrite: boolean } {
  const granted = scopeList(scopes);
  const canWrite = granted.includes(WRITE_SCOPE);
  return { canRead: canWrite || granted.includes(READ_SCOPE), canWrite };
}
