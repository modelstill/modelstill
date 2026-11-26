import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "../src/mcp-server.ts";
import { createApi } from "../src/upstream.ts";
import { instantTiming, type StubbedFetch } from "./stub.ts";

export const TEST_KEY = "ms_live_test";

export async function connect(stub: StubbedFetch): Promise<Client> {
  const api = createApi({
    baseUrl: "http://api.test",
    credential: TEST_KEY,
    fetch: stub.fetch,
    timing: instantTiming().timing,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([buildMcpServer(api).connect(serverSide), client.connect(clientSide)]);
  await client.listTools();
  return client;
}

export interface AnswerBody {
  error?: string;
  message?: string;
  next_step?: string;
  retryable?: boolean;
  retry_after?: number;
  unknown_arguments?: string[];
  [key: string]: unknown;
}

export interface ToolAnswer {
  isError: boolean;
  body: AnswerBody;
  structured: Record<string, unknown> | undefined;
}

export async function callTool(client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolAnswer> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text: string }[];
  return {
    isError: result.isError === true,
    body: JSON.parse(content[0]!.text),
    structured: result.structuredContent as Record<string, unknown> | undefined,
  };
}
