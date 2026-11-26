import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { OPENAPI_PATH, renderOpenApiJson } from "../scripts/sync-openapi.ts";
import { mdxFiles, read, relativeToContent } from "./content.ts";

describe("the committed openapi.json", () => {
  test("matches the document the API publishes; run `bun run sync:openapi` in apps/docs and commit it", async () => {
    expect(readFileSync(OPENAPI_PATH, "utf8")).toBe(await renderOpenApiJson());
  });

  test("names the self-hosted API on localhost as its server", async () => {
    const document = JSON.parse(await renderOpenApiJson()) as { servers: { url: string }[]; paths: Record<string, unknown> };
    expect(document.servers.map((server) => server.url)).toEqual(["http://localhost:8787"]);
    expect(Object.keys(document.paths)).toContain("/v1/tasks");
    expect(Object.keys(document.paths)).toContain("/v1/eval-runs/compare");
  });

  test("every operation has an API reference page and every page names a real operation", async () => {
    const document = JSON.parse(await renderOpenApiJson()) as { paths: Record<string, Record<string, unknown>> };
    const published = Object.entries(document.paths)
      .flatMap(([path, methods]) => Object.keys(methods).map((method) => `${method} ${path}`))
      .sort();
    const documented = mdxFiles()
      .filter((file) => relativeToContent(file).startsWith("api-reference/"))
      .flatMap((file) => [...read(file).matchAll(/\{ path: "([^"]+)", method: "([a-z]+)" \}/g)])
      .map(([, path, method]) => `${method} ${path}`)
      .sort();
    expect(documented).toEqual(published);
  });
});
