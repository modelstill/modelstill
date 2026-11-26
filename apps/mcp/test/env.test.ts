import { describe, expect, test } from "bun:test";
import { readConfig } from "../src/env.ts";

describe("readConfig", () => {
  test("defaults to the local API on 8787 and port 3104", () => {
    const config = readConfig({});
    expect(config.apiUrl).toBe("http://localhost:8787");
    expect(config.publicUrl).toBe("http://localhost:3104");
    expect(config.port).toBe(3104);
    expect(config.unauthLimit).toBe(30);
    expect(config.unauthWindowMs).toBe(60_000);
  });

  test("reads every variable and drops trailing slashes", () => {
    const config = readConfig({
      MODELSTILL_API_URL: "https://api.example.test/",
      PUBLIC_URL: "https://mcp.example.test/",
      PORT: "4000",
      MCP_UNAUTH_LIMIT: "5",
      MCP_UNAUTH_WINDOW_SECONDS: "10",
    });
    expect(config).toEqual({
      apiUrl: "https://api.example.test",
      publicUrl: "https://mcp.example.test",
      port: 4000,
      unauthLimit: 5,
      unauthWindowMs: 10_000,
      docsUrl: "https://mcp.example.test/docs",
    });
  });

  test("MCP_DOCS_URL overrides where refusals send people", () => {
    expect(readConfig({ MCP_DOCS_URL: "https://docs.example.test/mcp" }).docsUrl).toBe("https://docs.example.test/mcp");
  });

  test("a PUBLIC_URL left unset follows PORT", () => {
    expect(readConfig({ PORT: "5000" }).publicUrl).toBe("http://localhost:5000");
  });

  test("refuses a URL that is not one", () => {
    expect(() => readConfig({ MODELSTILL_API_URL: "not a url" })).toThrow();
  });
});
