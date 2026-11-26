export const DEFAULT_MCP_URL = "http://localhost:3104/mcp";

export const MCP_SERVER_NAME = "modelstill";

export const API_KEY_ENV = "MODELSTILL_API_KEY";

export function mcpUrl(env: Record<string, string | undefined> = { NEXT_PUBLIC_MCP_URL: process.env.NEXT_PUBLIC_MCP_URL }): string {
  return env["NEXT_PUBLIC_MCP_URL"] || DEFAULT_MCP_URL;
}

export function claudeCommand(url: string): string {
  return `claude mcp add --transport http ${MCP_SERVER_NAME} ${url}`;
}

export function mcpJsonConfig(url: string): string {
  return JSON.stringify(
    { mcpServers: { [MCP_SERVER_NAME]: { type: "http", url, headers: { Authorization: `Bearer \${${API_KEY_ENV}}` } } } },
    null,
    2,
  );
}

export function cursorConfig(url: string): string {
  return JSON.stringify(
    { mcpServers: { [MCP_SERVER_NAME]: { url, headers: { Authorization: `Bearer \${env:${API_KEY_ENV}}` } } } },
    null,
    2,
  );
}
