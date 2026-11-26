import { describe, expect, test } from "bun:test";
import {
  clickhouseCode,
  createFailoverClient,
  failoverAcrossHosts,
  hostsOf,
  isConnectionReset,
  isReplicaUnusable,
  parseHostList,
  REPLICA_UNUSABLE_CODES,
  splitHosts,
  UNHEALTHY_COOLDOWN_MS,
} from "../src/index.ts";

type Outcome = { fail?: () => unknown; body?: () => unknown; rows?: unknown };

function chError(code: number, name: string): Error {
  return Object.assign(new Error(`Code: ${code}. DB::Exception: ${name}`), { code: String(code), type: name });
}

function host(name: string, calls: string[], outcome: () => Outcome = () => ({})) {
  const seen: unknown[] = [];
  const closed: string[] = [];
  return {
    name,
    seen,
    closed,
    query: async (params: unknown) => {
      calls.push(name);
      seen.push(params);
      const { fail, body, rows } = outcome();
      if (fail) throw fail();
      const read = async () => {
        if (body) throw body();
        return rows ?? [{ host: name }];
      };
      return { json: read, text: async () => JSON.stringify(await read()), query_id: `${name}-id` };
    },
    insert: async () => `${name}-insert`,
    ping: async () => ({ success: true, host: name }),
    close: async () => {
      closed.push(name);
    },
  };
}

const always = (outcome: Outcome) => () => outcome;
const rows = async (ch: unknown, params: unknown = {}) =>
  (await (ch as { query: (p: unknown) => Promise<{ json: () => Promise<unknown> }> }).query(params)).json();

describe("splitHosts", () => {
  test("a comma-separated list, trimmed, empties dropped, order kept", () => {
    expect(splitHosts(" http://u:p@a:8123/db , http://b:8123 ,, ")).toEqual(["http://u:p@a:8123/db", "http://b:8123"]);
  });
});

describe("failoverAcrossHosts, preferred order", () => {
  test("every query goes to the first host while it answers", async () => {
    const calls: string[] = [];
    const ch = failoverAcrossHosts([host("primary", calls), host("b", calls), host("c", calls)] as never);
    for (let i = 0; i < 4; i++) expect(await rows(ch)).toEqual([{ host: "primary" }]);
    expect(calls).toEqual(["primary", "primary", "primary", "primary"]);
  });

  test("the query text, params and settings reach the host as the same object, on the retry too", async () => {
    const calls: string[] = [];
    const a = host("a", calls, always({ fail: () => chError(60, "UNKNOWN_TABLE") }));
    const b = host("b", calls);
    const ch = failoverAcrossHosts([a, b] as never);
    const params = { query: "SELECT 1", query_params: { x: 1 }, format: "JSONEachRow", clickhouse_settings: { priority: 3 } };
    await rows(ch, params);
    expect(a.seen[0]).toBe(params);
    expect(b.seen[0]).toBe(params);
  });

  test.each([...REPLICA_UNUSABLE_CODES].map((code) => [code]))("ClickHouse code %i on the primary is answered by the next host", async (code) => {
    const calls: string[] = [];
    const ch = failoverAcrossHosts([host("a", calls, always({ fail: () => chError(code, "REPLICA") })), host("b", calls)] as never);
    expect(await rows(ch)).toEqual([{ host: "b" }]);
    expect(calls).toEqual(["a", "b"]);
  });

  test("ECONNREFUSED on the primary is answered by the next host", async () => {
    const calls: string[] = [];
    const refused = () => Object.assign(new Error("connect ECONNREFUSED 192.0.2.10:8123"), { code: "ECONNREFUSED" });
    const ch = failoverAcrossHosts([host("a", calls, always({ fail: refused })), host("b", calls)] as never);
    expect(await rows(ch)).toEqual([{ host: "b" }]);
    expect(calls).toEqual(["a", "b"]);
  });

  test("Bun's reset shape (code ECONNRESET, no Node words in the message) fails over after one more try", async () => {
    const calls: string[] = [];
    const reset = () => Object.assign(new Error("The socket connection was closed unexpectedly"), { code: "ECONNRESET" });
    const ch = failoverAcrossHosts([host("a", calls, always({ fail: reset })), host("b", calls)] as never);
    expect(await rows(ch)).toEqual([{ host: "b" }]);
    expect(calls).toEqual(["a", "a", "b"]);
  });

  test.each([
    [159, "TIMEOUT_EXCEEDED"],
    [241, "MEMORY_LIMIT_EXCEEDED"],
    [394, "QUERY_WAS_CANCELLED"],
    [62, "SYNTAX_ERROR"],
    [202, "TOO_MANY_SIMULTANEOUS_QUERIES"],
  ])("a query's own error (%i) is thrown from the primary, no other host is asked, the primary stays first", async (code, name) => {
    const calls: string[] = [];
    let failing = true;
    const ch = failoverAcrossHosts([host("a", calls, () => (failing ? { fail: () => chError(code, name) } : {})), host("b", calls)] as never);
    await expect(rows(ch)).rejects.toThrow(name);
    expect(calls).toEqual(["a"]);
    failing = false;
    expect(await rows(ch)).toEqual([{ host: "a" }]);
  });

  test("no failover once the caller's signal is aborted, even on a transport error", async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    const a = host(
      "a",
      calls,
      always({
        fail: () => {
          controller.abort();
          return new Error("The user aborted a request.");
        },
      }),
    );
    const ch = failoverAcrossHosts([a, host("b", calls)] as never);
    await expect(rows(ch, { abort_signal: controller.signal })).rejects.toThrow("aborted");
    expect(calls).toEqual(["a"]);
    await rows(ch).catch(() => undefined);
    expect(calls[1]).toBe("a");
  });

  test("a failed primary is tried last for the cooldown, then first again", async () => {
    const calls: string[] = [];
    let clock = 1_000;
    let down = true;
    const ch = failoverAcrossHosts(
      [host("a", calls, () => (down ? { fail: () => chError(60, "UNKNOWN_TABLE") } : {})), host("b", calls), host("c", calls)] as never,
      { now: () => clock },
    );
    await rows(ch);
    expect(calls).toEqual(["a", "b"]);
    down = false;
    clock += UNHEALTHY_COOLDOWN_MS - 1;
    await rows(ch);
    expect(calls).toEqual(["a", "b", "b"]);
    clock += 2;
    await rows(ch);
    await rows(ch);
    expect(calls).toEqual(["a", "b", "b", "a", "a"]);
  });

  test("a host in cooldown is still reached when every other host fails, and all hosts down throws the first error", async () => {
    const calls: string[] = [];
    let aDown = true;
    const a = host("a", calls, () => (aDown ? { fail: () => chError(60, "FIRST") } : {}));
    const b = host("b", calls, always({ fail: () => chError(232, "SECOND") }));
    const ch = failoverAcrossHosts([a, b] as never, { now: () => 5 });
    await expect(rows(ch)).rejects.toThrow("FIRST");
    expect(calls).toEqual(["a", "b"]);
    aDown = false;
    expect(await rows(ch)).toEqual([{ host: "a" }]);
  });

  test("the secondaries are tried in list order", async () => {
    const calls: string[] = [];
    const dead = always({ fail: () => chError(695, "ASYNC_LOAD_FAILED") });
    const ch = failoverAcrossHosts([host("a", calls, dead), host("b", calls, dead), host("c", calls)] as never);
    expect(await rows(ch)).toEqual([{ host: "c" }]);
    expect(calls).toEqual(["a", "b", "c"]);
  });

  test("a body that dies in json() after the 200 re-runs the query on the next host", async () => {
    const calls: string[] = [];
    const premature = () => Object.assign(new Error("Premature close"), { code: "ERR_STREAM_PREMATURE_CLOSE" });
    const ch = failoverAcrossHosts([host("a", calls, always({ body: premature })), host("b", calls)] as never);
    expect(await rows(ch)).toEqual([{ host: "b" }]);
    expect(calls).toEqual(["a", "a", "b"]);
  });

  test("a result row with a string column named exception is a row, on a list of hosts too", async () => {
    const calls: string[] = [];
    const answer = [
      { id: 1, exception: "Code: 60. DB::Exception: Table x does not exist. (UNKNOWN_TABLE)" },
      { exception: "none" },
      { exception: "Code: 60. DB::Exception: quoted from a log table", at: "2026-11-11" },
    ];
    const ch = failoverAcrossHosts([host("a", calls, always({ rows: answer })), host("b", calls)] as never);
    expect(await rows(ch)).toEqual(answer);
    expect(calls).toEqual(["a"]);
    const single = failoverAcrossHosts([host("a", calls, always({ rows: { exception: "a JSON object, not a marker" } })), host("b", calls)] as never);
    expect(await rows(single)).toEqual({ exception: "a JSON object, not a marker" });
  });

  test("only the last row can be the server's marker: the same object earlier in the result is a row", async () => {
    const calls: string[] = [];
    const answer = [{ exception: "Code: 232. DB::Exception: No such data part (NO_SUCH_DATA_PART)" }, { exception: "ok" }];
    const ch = failoverAcrossHosts([host("a", calls, always({ rows: answer })), host("b", calls)] as never);
    expect(await rows(ch)).toEqual(answer);
    expect(calls).toEqual(["a"]);
  });

  test("an exception row the server wrote into the body decides by its code", async () => {
    const calls: string[] = [];
    const broken = host("a", calls, always({ rows: [{ id: 1 }, { exception: "Code: 232. DB::Exception: No such data part (NO_SUCH_DATA_PART)" }] }));
    expect(await rows(failoverAcrossHosts([broken, host("b", calls)] as never))).toEqual([{ host: "b" }]);
    const slow = host("a", calls, always({ rows: [{ exception: "Code: 159. DB::Exception: Timeout exceeded (TIMEOUT_EXCEEDED)" }] }));
    await expect(rows(failoverAcrossHosts([slow, host("b", calls)] as never))).rejects.toThrow("Timeout exceeded");
  });

  test("other properties of the result set are kept", async () => {
    const ch = failoverAcrossHosts([host("a", []), host("b", [])] as never);
    expect(((await ch.query({} as never)) as unknown as { query_id: string }).query_id).toBe("a-id");
  });

  test("a single host is returned as it is", () => {
    const only = host("a", []);
    expect(failoverAcrossHosts([only] as never) as unknown).toBe(only);
  });

  test("everything but query stays on the primary, and close closes every host", async () => {
    const a = host("a", []);
    const b = host("b", []);
    const ch = failoverAcrossHosts([a, b] as never) as unknown as { insert: () => Promise<string>; close: () => Promise<void> };
    expect(await ch.insert()).toBe("a-insert");
    await ch.close();
    expect([...a.closed, ...b.closed]).toEqual(["a", "b"]);
  });

  test("hostsOf lists the hosts behind a failover client, and a plain client as itself", () => {
    const a = host("a", []);
    expect(hostsOf(failoverAcrossHosts([a, host("b", [])] as never))).toHaveLength(2);
    expect(hostsOf(a as never)).toEqual([a as never]);
  });
});

describe("a statement that fails the same way on every host (model-written SQL, unknown table)", () => {
  const unknownTable = () => chError(60, "UNKNOWN_TABLE");

  test("is tried on every host once, marks none of them, and throws the first host's error", async () => {
    const calls: string[] = [];
    const bad = (name: string) => host(name, calls, always({ fail: () => chError(60, `UNKNOWN_TABLE on ${name}`) }));
    const good = [host("a", calls), host("b", calls), host("c", calls)];
    const badHosts = [bad("a"), bad("b"), bad("c")];
    let useBad = true;
    const routed = good.map((g, i) => ({ ...g, query: (params: unknown) => (useBad ? badHosts[i]!.query(params) : g.query(params)) }));
    const ch = failoverAcrossHosts(routed as never, { now: () => 1_000 });
    await expect(rows(ch)).rejects.toThrow("UNKNOWN_TABLE on a");
    expect(calls).toEqual(["a", "b", "c"]);
    useBad = false;
    calls.length = 0;
    expect(await rows(ch)).toEqual([{ host: "a" }]);
    expect(calls).toEqual(["a"]);
  });

  test("a good query running beside it leaves reads on the first host (the pinning the review reproduced)", async () => {
    const calls: string[] = [];
    const gates: Array<() => void> = [];
    const gated = (name: string) => ({
      ...host(name, calls),
      query: async (params: { bad?: boolean }) => {
        calls.push(`${name}:${params.bad ? "bad" : "good"}`);
        if (!params.bad) return { json: async () => [{ host: name }] };
        await new Promise<void>((resolve) => gates.push(resolve));
        throw unknownTable();
      },
    });
    const ch = failoverAcrossHosts([gated("a"), gated("b"), gated("c")] as never, { now: () => 1_000 });
    const release = async () => {
      while (gates.length === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      gates.shift()!();
    };
    const badQuery = rows(ch, { bad: true }).then(
      () => "answered",
      (error: Error) => error.message,
    );
    await release();
    await release();
    expect(await rows(ch, {})).toEqual([{ host: "a" }]);
    await release();
    expect(await badQuery).toContain("UNKNOWN_TABLE");
    expect(await rows(ch, {})).toEqual([{ host: "a" }]);
    expect(await rows(ch, {})).toEqual([{ host: "a" }]);
    expect(calls).toEqual(["a:bad", "b:bad", "a:good", "c:bad", "a:good", "a:good"]);
  });

  test("a host is marked once a LATER host answers the same query, and the ones before it with it", async () => {
    const calls: string[] = [];
    let down = true;
    const dead = () => (down ? { fail: unknownTable } : {});
    const ch = failoverAcrossHosts([host("a", calls, dead), host("b", calls, dead), host("c", calls)] as never, { now: () => 1_000 });
    expect(await rows(ch)).toEqual([{ host: "c" }]);
    down = false;
    expect(await rows(ch)).toEqual([{ host: "c" }]);
    expect(calls).toEqual(["a", "b", "c", "c"]);
  });

  test("every host refusing the connection marks none either", async () => {
    const calls: string[] = [];
    let down = true;
    const refused = () => (down ? { fail: () => Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) } : {});
    const ch = failoverAcrossHosts([host("a", calls, refused), host("b", calls, refused)] as never, { now: () => 1_000 });
    await expect(rows(ch)).rejects.toThrow("ECONNREFUSED");
    down = false;
    expect(await rows(ch)).toEqual([{ host: "a" }]);
  });
});

describe("a connection reset is retried on the same host before any other", () => {
  const resets = [
    ["ECONNRESET", () => Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })],
    ["socket hang up", () => Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })],
    ["socket hang up, no code", () => new Error("socket hang up")],
  ] as const;

  test.each(resets)("one %s on the first host: the first host answers the retry and stays first", async (_name, reset) => {
    const calls: string[] = [];
    let failures = 1;
    const a = host("a", calls, () => (failures-- > 0 ? { fail: reset } : {}));
    const ch = failoverAcrossHosts([a, host("b", calls)] as never, { now: () => 1_000 });
    expect(await rows(ch)).toEqual([{ host: "a" }]);
    expect(await rows(ch)).toEqual([{ host: "a" }]);
    expect(calls).toEqual(["a", "a", "a"]);
  });

  test("two resets in a row move the query to the next host, and only then is the first marked", async () => {
    const calls: string[] = [];
    let failures = 2;
    const a = host("a", calls, () => (failures-- > 0 ? { fail: resets[0][1] } : {}));
    const ch = failoverAcrossHosts([a, host("b", calls)] as never, { now: () => 1_000 });
    expect(await rows(ch)).toEqual([{ host: "b" }]);
    expect(await rows(ch)).toEqual([{ host: "b" }]);
    expect(calls).toEqual(["a", "a", "b", "b"]);
  });

  test("a body cut once mid-stream is read again from the same host", async () => {
    const calls: string[] = [];
    let failures = 1;
    const premature = () => Object.assign(new Error("Premature close"), { code: "ERR_STREAM_PREMATURE_CLOSE" });
    const a = host("a", calls, () => (failures-- > 0 ? { body: premature } : {}));
    const ch = failoverAcrossHosts([a, host("b", calls)] as never, { now: () => 1_000 });
    expect(await rows(ch)).toEqual([{ host: "a" }]);
    expect(await rows(ch)).toEqual([{ host: "a" }]);
    expect(calls).toEqual(["a", "a", "a"]);
  });

  test("a refused connection is not retried on the same host", async () => {
    const calls: string[] = [];
    const refused = () => Object.assign(new Error("connect ECONNREFUSED 192.0.2.10:8123"), { code: "ECONNREFUSED" });
    const ch = failoverAcrossHosts([host("a", calls, always({ fail: refused })), host("b", calls)] as never);
    await rows(ch);
    expect(calls).toEqual(["a", "b"]);
  });

  test("no retry once the caller's signal is aborted", async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    const a = host(
      "a",
      calls,
      always({
        fail: () => {
          controller.abort();
          return resets[0][1]();
        },
      }),
    );
    const ch = failoverAcrossHosts([a, host("b", calls)] as never);
    await expect(rows(ch, { abort_signal: controller.signal })).rejects.toThrow("ECONNRESET");
    expect(calls).toEqual(["a"]);
  });

  test("isConnectionReset: resets and cut bodies, never a refusal, a DNS failure or a ClickHouse code", () => {
    expect(isConnectionReset(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toBe(true);
    expect(isConnectionReset(Object.assign(new Error("x"), { code: "EPIPE" }))).toBe(true);
    expect(isConnectionReset(new Error("socket hang up"))).toBe(true);
    expect(isConnectionReset(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }))).toBe(false);
    expect(isConnectionReset(Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }))).toBe(false);
    expect(isConnectionReset(chError(60, "UNKNOWN_TABLE, read ECONNRESET in the text"))).toBe(false);
    expect(isConnectionReset(null)).toBe(false);
  });
});

describe("failoverAcrossHosts, round-robin order", () => {
  test("each query starts on the next host", async () => {
    const calls: string[] = [];
    const ch = failoverAcrossHosts([host("a", calls), host("b", calls)] as never, { order: "round-robin" });
    for (let i = 0; i < 3; i++) await rows(ch);
    expect(calls).toEqual(["a", "b", "a"]);
  });
});

describe("createFailoverClient", () => {
  test("builds one client per url in list order and prefers the first", async () => {
    const calls: string[] = [];
    const built: string[] = [];
    const ch = createFailoverClient("http://u:secret@r0:8123/db, http://u:secret@r1:8123/db", (url) => {
      built.push(url.host);
      return host(url.host, calls) as never;
    });
    expect(built).toEqual(["r0:8123", "r1:8123"]);
    expect(await rows(ch)).toEqual([{ host: "r0:8123" }]);
  });

  test("an empty list is refused", () => {
    expect(() => createFailoverClient(" , ", () => host("x", []) as never)).toThrow("no ClickHouse host");
  });

  test.each([
    ["no scheme", "api_reader:s3cr3t-Pa55w0rd@ch-0-1:8123/modelstill"],
    ["a space in the host", "http://api_reader:s3cr3t-Pa55w0rd@ch 0-1:8123/modelstill"],
    ["a port that is not a number", "http://api_reader:s3cr3t-Pa55w0rd@ch-0-1:port/modelstill"],
    ["another scheme", "tcp://api_reader:s3cr3t-Pa55w0rd@ch-0-1:9000/modelstill"],
    ["a password with a raw slash and at", "http://api_reader:s3cr3t-Pa55w0rd/@x@:8123"],
  ])("a malformed entry (%s) is named by its index, and no part of it is in the message", (_name, entry) => {
    const list = `http://api_reader:s3cr3t-Pa55w0rd@ch-0-2:8123/modelstill, ${entry}`;
    const built: string[] = [];
    let thrown: unknown;
    try {
      createFailoverClient(list, (url) => {
        built.push(url.host);
        return host(url.host, []) as never;
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    const shown = `${(thrown as Error).message}\n${(thrown as Error).stack}\n${JSON.stringify(thrown, Object.getOwnPropertyNames(thrown as object))}\n${Bun.inspect(thrown)}`;
    expect((thrown as Error).message).toContain("entry 1");
    for (const part of ["s3cr3t-Pa55w0rd", "s3cr3t", "Pa55w0rd", "api_reader", "ch-0-1", "ch 0-1"]) expect(shown).not.toContain(part);
    expect((thrown as Error).cause).toBeUndefined();
    expect(built).toEqual([]);
  });

  test("parseHostList returns the entries as URLs, in order", () => {
    expect(parseHostList("http://u:p@a:8123/db,https://b:8443").map((url) => url.host)).toEqual(["a:8123", "b:8443"]);
  });

  test("the failover log line names host:port, never the credentials", async () => {
    const logged: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    const warn = console.warn;
    const log = console.log;
    const capture = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
    process.stdout.write = ((chunk: unknown) => (logged.push(String(chunk)), true)) as never;
    console.warn = capture;
    console.log = capture;
    try {
      const ch = createFailoverClient("http://api_reader:s3cr3t-Pa55w0rd@r0:8123/db,http://api_reader:s3cr3t-Pa55w0rd@r1:8123/db", (url) =>
        host(url.host, [], url.hostname === "r0" ? always({ fail: () => chError(232, "NO_SUCH_DATA_PART") }) : undefined) as never,
      );
      expect(await rows(ch)).toEqual([{ host: "r1:8123" }]);
    } finally {
      process.stdout.write = write;
      console.warn = warn;
      console.log = log;
    }
    const text = logged.join("");
    expect(text).not.toContain("s3cr3t");
    expect(text).not.toContain("api_reader");
  });
});

describe("isReplicaUnusable", () => {
  test("a ClickHouse code decides alone, whatever the message says", () => {
    expect(isReplicaUnusable(chError(60, "UNKNOWN_TABLE"))).toBe(true);
    expect(isReplicaUnusable(Object.assign(new Error("Code: 394. Query was cancelled, connection aborted"), { code: "394" }))).toBe(false);
    expect(isReplicaUnusable(new Error("Error: 502 Bad Gateway"))).toBe(false);
    expect(isReplicaUnusable(null)).toBe(false);
  });

  test("clickhouseCode reads the code field or the Code: prefix", () => {
    expect(clickhouseCode(chError(241, "MEMORY"))).toBe(241);
    expect(clickhouseCode(new Error("Code: 60. DB::Exception"))).toBe(60);
    expect(clickhouseCode(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toBeNull();
  });
});
