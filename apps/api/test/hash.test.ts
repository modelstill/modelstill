import { describe, expect, test } from "bun:test";
import { contentHash, stableJson } from "../src/hash.ts";

describe("content hashing", () => {
  test("serialises objects with sorted keys and no whitespace", () => {
    expect(stableJson({ b: [2, { d: 1, c: null }], a: "x" })).toBe('{"a":"x","b":[2,{"c":null,"d":1}]}');
  });

  test("the hash ignores key order and is a sha256 hex digest", () => {
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
    expect(contentHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
  });
});
