export const API_KEY_PREFIX = "ms_live_";

export const PERMISSION_RESOURCE = "modelstill";

export type KeyPermission = "read" | "write";

export const READ_PERMISSIONS = { [PERMISSION_RESOURCE]: ["read"] };

export function permissionsFor(permission: KeyPermission): Record<string, string[]> {
  return { [PERMISSION_RESOURCE]: permission === "write" ? ["read", "write"] : ["read"] };
}

export function keyAccess(permissions: Record<string, string[]> | null | undefined): { canRead: boolean; canWrite: boolean } {
  const granted = permissions?.[PERMISSION_RESOURCE] ?? [];
  const canWrite = granted.includes("write");
  return { canRead: canWrite || granted.includes("read"), canWrite };
}

export function permissionOf(permissions: Record<string, string[]> | null | undefined): KeyPermission {
  return keyAccess(permissions).canWrite ? "write" : "read";
}
