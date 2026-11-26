import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { errorFields, installProcessGuards, type ProcessGuardOptions } from "./process-guards.ts";

function harness(overrides: Partial<ProcessGuardOptions> = {}) {
  const lines: Array<[unknown, Record<string, unknown> | undefined]> = [];
  const reports: Array<[unknown, string]> = [];
  const exits: number[] = [];
  const proc = new EventEmitter();
  installProcessGuards({
    logger: { error: (message, meta) => lines.push([message, meta]) },
    report: (error, kind) => reports.push([error, kind]),
    exit: (code) => exits.push(code),
    proc,
    ...overrides,
  });
  return { lines, reports, exits, proc };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("installProcessGuards", () => {
  test("an unhandled rejection is logged with its fields and the process goes on", () => {
    const { lines, reports, exits, proc } = harness();
    const error = Object.assign(new Error("server login has been failing"), { code: "08P01", severity: "FATAL" });
    proc.emit("unhandledRejection", error, Promise.resolve());
    expect(lines).toHaveLength(1);
    const [message, meta] = lines[0]!;
    expect(message).toBe("unhandled_rejection");
    expect(meta?.["error"]).toBe("server login has been failing");
    expect(meta?.["code"]).toBe("08P01");
    expect(meta?.["severity"]).toBe("FATAL");
    expect(String(meta?.["stack"]).split("\n").length).toBeLessThanOrEqual(8);
    expect(reports).toEqual([[error, "unhandled_rejection"]]);
    expect(exits).toEqual([]);
  });

  test("an uncaught exception is logged, reported, flushed, then exits with 1", async () => {
    let flushed = 0;
    const { lines, reports, exits, proc } = harness({ flush: async () => void flushed++ });
    const error = new TypeError("boom");
    proc.emit("uncaughtException", error);
    expect(lines[0]?.[0]).toBe("uncaught_exception");
    expect(reports).toEqual([[error, "uncaught_exception"]]);
    expect(exits).toEqual([]);
    await tick();
    expect(flushed).toBe(1);
    expect(exits).toEqual([1]);
  });

  test("a flush that rejects still lets the process exit", async () => {
    const { exits, proc } = harness({ flush: () => Promise.reject(new Error("transport gone")) });
    proc.emit("uncaughtException", new Error("boom"));
    await tick();
    expect(exits).toEqual([1]);
  });

  test("a throwing reporter does not break the guard", () => {
    const { lines, proc } = harness({
      report: () => {
        throw new Error("sentry down");
      },
    });
    expect(() => proc.emit("unhandledRejection", "plain string reason", Promise.resolve())).not.toThrow();
    expect(lines).toEqual([["unhandled_rejection", { error: "plain string reason" }]]);
  });
});

describe("errorFields", () => {
  test("keeps non-Error reasons readable", () => {
    expect(errorFields(42)).toEqual({ error: "42" });
  });

  test("follows the cause chain to a bounded depth and keeps own scalar fields", () => {
    const inner = Object.assign(new Error("inner"), { code: "ECONNRESET" });
    const outer = new Error("outer", { cause: inner });
    const fields = errorFields(outer);
    expect(fields["name"]).toBe("Error");
    expect((fields["cause"] as Record<string, unknown>)["code"]).toBe("ECONNRESET");
    let deep: Error = new Error("0");
    for (let i = 1; i <= 6; i++) deep = new Error(String(i), { cause: deep });
    let level = errorFields(deep);
    let depth = 0;
    while (level["cause"]) {
      level = level["cause"] as Record<string, unknown>;
      depth++;
    }
    expect(depth).toBe(3);
  });
});

const CHILD = `
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { installProcessGuards } from "${new URL("./process-guards.ts", import.meta.url).pathname}";
if (process.env.GUARD === "1") installProcessGuards({ logger: { error: (m, meta) => console.log("LOG", m, (meta as { code?: string }).code) } });
const server = createServer((_q, s) => s.end("ok")).listen(0, "127.0.0.1", () => {
  Promise.reject(Object.assign(new Error("late"), { code: "08P01" }));
  const stallUntil = performance.now() + Number(process.env.STALL_MS ?? 0);
  while (performance.now() < stallUntil);
  fetch("http://127.0.0.1:" + (server.address() as AddressInfo).port)
    .then((res) => res.text())
    .then((body) => { console.log("ALIVE", body); server.close(); process.exit(0); });
});
`;

function runChild(env: Record<string, string> = {}) {
  const out = Bun.spawnSync(["bun", "--no-env-file", "-e", CHILD], { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
  return { code: out.exitCode, stdout: out.stdout.toString(), stderr: out.stderr.toString() };
}

describe("Bun exits on an unhandled rejection after module evaluation", () => {
  test("without the guards the process dies before the next tick of work", () => {
    const child = runChild();
    expect(child.code).toBe(1);
    expect(child.stdout).not.toContain("ALIVE");
    expect(child.stderr).toContain("late");
  });

  test("a runner that stalls right after the rejection changes nothing", () => {
    const child = runChild({ STALL_MS: "300" });
    expect(child.code).toBe(1);
    expect(child.stdout).not.toContain("ALIVE");
  });

  test("with the guards the rejection is logged and the server keeps running", () => {
    const child = runChild({ GUARD: "1" });
    expect(child.code).toBe(0);
    expect(child.stdout).toContain("LOG unhandled_rejection 08P01");
    expect(child.stdout).toContain("ALIVE ok");
  });
});
