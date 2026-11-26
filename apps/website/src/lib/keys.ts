import type { CreatedApiKey, KeyPermission } from "./api";
import { API_KEY_ENV } from "./mcp";

export type ApiKeyRow = {
  id: string;
  name: string | null;
  start: string | null;
  permission: KeyPermission;
  createdAt: string;
  lastRequest: string | null;
};

export type ListedKey = {
  id: string;
  name?: string | null;
  start?: string | null;
  prefix?: string | null;
  permissions?: Record<string, string[]> | null;
  createdAt: string | Date;
  lastRequest?: string | Date | null;
};

type AuthResult<T> = { data: T | null; error: { message?: string } | null };

export type KeyAuthClient = {
  apiKey: {
    list: (input: { query: Record<string, never> }) => Promise<AuthResult<{ apiKeys: ListedKey[] }>>;
    delete: (input: { keyId: string }) => Promise<AuthResult<unknown>>;
  };
};

export type KeysApi = {
  list: () => Promise<ApiKeyRow[]>;
  create: (name: string, permission: KeyPermission) => Promise<CreatedApiKey>;
  revoke: (id: string) => Promise<void>;
};

function iso(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : value;
}

export function toKeyRow(key: ListedKey): ApiKeyRow {
  const granted = key.permissions?.["modelstill"] ?? [];
  return {
    id: key.id,
    name: key.name ?? null,
    start: key.start ?? null,
    permission: granted.includes("write") ? "write" : "read",
    createdAt: iso(key.createdAt) ?? "",
    lastRequest: iso(key.lastRequest),
  };
}

export function createKeysApi(
  api: { createApiKey: (name: string, permission: KeyPermission) => Promise<CreatedApiKey> },
  authClient: KeyAuthClient,
): KeysApi {
  return {
    list: async () => {
      const { data, error } = await authClient.apiKey.list({ query: {} });
      if (error || !data) throw new Error(error?.message ?? "could not list API keys");
      return data.apiKeys.map(toKeyRow);
    },
    create: (name, permission) => api.createApiKey(name, permission),
    revoke: async (id) => {
      const { error } = await authClient.apiKey.delete({ keyId: id });
      if (error) throw new Error(error.message ?? "could not revoke the key");
    },
  };
}

export function createKeyCurl(apiUrl: string, name: string, permission: KeyPermission): string {
  return [
    `curl -X POST ${apiUrl}/v1/api-keys \\`,
    "  -b cookies.txt \\",
    '  -H "content-type: application/json" \\',
    `  -d '${JSON.stringify({ name, permission })}'`,
  ].join("\n");
}

export function permissionScopes(permission: KeyPermission): string[] {
  return permission === "write" ? ["read", "write"] : ["read"];
}

export function maskedKey(start: string | null): string {
  return `${start ?? "ms_live_"}${"•".repeat(12)}`;
}

export function curlSample(apiUrl: string): string {
  return `curl ${apiUrl}/v1/tasks \\\n  -H "Authorization: Bearer $${API_KEY_ENV}"`;
}
