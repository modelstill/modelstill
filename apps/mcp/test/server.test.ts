import { describe, expect, test } from "bun:test";
import { createServer } from "../src/server.ts";

describe("createServer", () => {
  test("listens on PORT and serves the app", async () => {
    const server = createServer({ PORT: "3999" });
    expect(server.port).toBe(3999);
    const res = await server.fetch(new Request("http://localhost/healthz"));
    expect(await res.text()).toBe("ok");
  });

  test("defaults to port 3104", () => {
    expect(createServer({}).port).toBe(3104);
  });
});
