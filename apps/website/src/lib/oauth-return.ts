export const SIGNED_IN_HOME = "/tasks";

export function pendingAuthorizeUrl(params: URLSearchParams | null, apiUrl: string): string | null {
  if (!params?.get("client_id") || !params.get("response_type")) return null;
  return `${apiUrl.replace(/\/+$/, "")}/api/auth/mcp/authorize?${params.toString()}`;
}

function isSafePath(path: string | null | undefined): path is string {
  return Boolean(path && path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\"));
}

export function postSignInPath(params: URLSearchParams | null): string {
  const next = params?.get("next");
  return isSafePath(next) ? next : SIGNED_IN_HOME;
}
