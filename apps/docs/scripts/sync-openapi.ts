import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "@modelstill/api/src/app.ts";
import { createMemoryStore } from "@modelstill/api/src/store-memory.ts";

export const OPENAPI_PATH = join(import.meta.dir, "..", "openapi.json");
export const API_SERVER = { url: "http://localhost:8787", description: "Self-hosted API on your machine" };

export async function renderOpenApiJson(): Promise<string> {
  const response = await createApp({ store: createMemoryStore() }).request("/openapi.json");
  const document = (await response.json()) as Record<string, unknown>;
  return `${JSON.stringify({ ...document, servers: [API_SERVER] }, null, 2)}\n`;
}

if (import.meta.main) {
  writeFileSync(OPENAPI_PATH, await renderOpenApiJson());
  console.log(`[sync-openapi] wrote ${OPENAPI_PATH}`);
}
