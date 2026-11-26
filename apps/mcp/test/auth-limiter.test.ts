import { describe, expect, test } from "bun:test";
import { clientKeyOf, createAuthRejectionLimiter } from "../src/auth-limiter.ts";

function clock(start = 0) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe("auth rejection limiter", () => {
  test("allows a burst of refusals, then answers not allowed until the window ends", () => {
    const time = clock();
    const limiter = createAuthRejectionLimiter({ limit: 2, windowMs: 60_000, now: time.now });
    expect(limiter.reject("ip").allowed).toBe(true);
    expect(limiter.reject("ip").allowed).toBe(true);
    const third = limiter.reject("ip");
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSec).toBe(60);
    time.advance(30_000);
    expect(limiter.reject("ip").retryAfterSec).toBe(30);
    time.advance(30_000);
    expect(limiter.reject("ip").allowed).toBe(true);
  });

  test("counts each client on its own", () => {
    const limiter = createAuthRejectionLimiter({ limit: 1, windowMs: 1000 });
    limiter.reject("a");
    expect(limiter.reject("a").allowed).toBe(false);
    expect(limiter.reject("b").allowed).toBe(true);
  });

  test("a limit of 0 turns it off", () => {
    const limiter = createAuthRejectionLimiter({ limit: 0, windowMs: 1000 });
    for (let i = 0; i < 10; i++) expect(limiter.reject("a").allowed).toBe(true);
  });

  test("forgets expired clients once it holds too many", () => {
    const time = clock();
    const limiter = createAuthRejectionLimiter({ limit: 1, windowMs: 1000, maxClients: 2, now: time.now });
    limiter.reject("a");
    limiter.reject("b");
    time.advance(2000);
    limiter.reject("c");
    expect(limiter.size()).toBe(1);
  });
});

describe("clientKeyOf", () => {
  test("uses the last X-Forwarded-For hop, the one the ingress appended", () => {
    const request = new Request("http://x/", { headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2" } });
    expect(clientKeyOf(request)).toBe("2.2.2.2");
  });

  test("falls back to X-Real-IP, then to one shared bucket", () => {
    expect(clientKeyOf(new Request("http://x/", { headers: { "x-real-ip": "3.3.3.3" } }))).toBe("3.3.3.3");
    expect(clientKeyOf(new Request("http://x/"))).toBe("unknown");
  });
});
