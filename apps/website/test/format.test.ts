import { describe, expect, test } from "bun:test";
import { formatCanary, formatDateTime, formatHour, formatMs, shortHash } from "../src/lib/format";

describe("format helpers", () => {
  test("shortHash keeps an algorithm prefix and twelve characters", () => {
    expect(shortHash("sha256:0123456789abcdef0123")).toBe("sha256:0123456789ab");
    expect(shortHash("0123456789abcdef")).toBe("0123456789ab");
    expect(shortHash(null)).toBe("n/a");
  });

  test("formatDateTime renders UTC to the minute", () => {
    expect(formatDateTime("2026-11-20T10:05:33Z")).toBe("2026-11-20 10:05 UTC");
    expect(formatDateTime(null)).toBe("n/a");
    expect(formatDateTime("not a date")).toBe("not a date");
  });

  test("formatHour renders the UTC hour", () => {
    expect(formatHour("2026-11-20T09:00:00Z")).toBe("11-20 09:00");
  });

  test("formatMs", () => {
    expect(formatMs(123.4)).toBe("123 ms");
    expect(formatMs(null)).toBe("n/a");
  });

  test("formatCanary shows the count and the pass rate with its interval", () => {
    expect(formatCanary({ passed: 19, total: 20, low: 0.751, high: 0.999 })).toBe("19/20, 0.95 [0.75, 1.00]");
    expect(formatCanary({ passed: 0, total: 0, low: 0, high: 1 })).toBe("0/0, n/a");
  });
});
