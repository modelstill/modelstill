export function connectDoc(publicUrl: string): string {
  const endpoint = `${publicUrl}/mcp`;
  return [
    "ModelStill MCP server",
    "",
    `Endpoint: ${endpoint} (Streamable HTTP, POST only, no sessions)`,
    "",
    "Sign in with OAuth from your MCP client, or send a ModelStill API key (ms_live_...)",
    "as an Authorization: Bearer header or an x-api-key header.",
    "",
    "Claude Code:",
    `  claude mcp add --transport http modelstill ${endpoint} --header "Authorization: Bearer \${MODELSTILL_API_KEY}"`,
    "",
    ".mcp.json or Cursor (~/.cursor/mcp.json):",
    `  { "mcpServers": { "modelstill": { "type": "http", "url": "${endpoint}", "headers": { "Authorization": "Bearer \${MODELSTILL_API_KEY}" } } } }`,
    "",
  ].join("\n");
}
