import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "@modelstill/mcp/src/mcp-server.ts";
import { createApi } from "@modelstill/mcp/src/upstream.ts";
import { CONTENT, read } from "./content.ts";

const MCP_PAGE = join(CONTENT, "ai-agents", "mcp.mdx");
const TOOL_ROW = /^\| `([a-z_]+)` \| (read|write) \|/gm;

const unusedFetch = (async () => {
  throw new Error("listing tools must not call the API");
}) as unknown as typeof fetch;

async function serverTools() {
  const api = createApi({ baseUrl: "http://api.test", credential: "ms_live_docs", fetch: unusedFetch });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "docs-test", version: "0.0.0" });
  await Promise.all([buildMcpServer(api).connect(serverSide), client.connect(clientSide)]);
  const { tools } = await client.listTools();
  await client.close();
  return tools.map((tool) => ({ name: tool.name, kind: tool.annotations?.readOnlyHint ? "read" : "write" }));
}

function documentedTools() {
  return [...read(MCP_PAGE).matchAll(TOOL_ROW)].map(([, name, kind]) => ({ name: name!, kind: kind! }));
}

describe("the MCP tools page", () => {
  test("lists exactly the tools the MCP server registers, with the right kind", async () => {
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    expect(documentedTools().sort(byName)).toEqual((await serverTools()).sort(byName));
  });

  test("lists each tool once", () => {
    const names = documentedTools().map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
