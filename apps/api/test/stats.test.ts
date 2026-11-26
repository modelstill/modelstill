import { describe, expect, test } from "bun:test";
import { bootstrapMean, clopperPearson, compareScores, seededRandom, summarizeScores } from "../src/stats.ts";

describe("seededRandom", () => {
  test("is deterministic for a seed and stays in [0, 1)", () => {
    const first = seededRandom(0);
    const second = seededRandom(0);
    const draws = Array.from({ length: 1000 }, () => first());
    expect(Array.from({ length: 1000 }, () => second())).toEqual(draws);
    expect(draws.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(new Set(draws).size).toBeGreaterThan(990);
  });

  test("different seeds give different streams", () => {
    expect(seededRandom(1)()).not.toBe(seededRandom(2)());
  });
});

describe("bootstrapMean", () => {
  test("a constant sample has a degenerate interval", () => {
    expect(bootstrapMean([0.5, 0.5, 0.5], 0, 2000)).toEqual({ low: 0.5, high: 0.5 });
  });

  test("brackets the sample mean and is reproducible", () => {
    const values = Array.from({ length: 300 }, (_, index) => (index % 10) / 10);
    const interval = bootstrapMean(values, 0, 2000);
    expect(interval.low).toBeLessThan(0.45);
    expect(interval.high).toBeGreaterThan(0.45);
    expect(interval.high - interval.low).toBeLessThan(0.1);
    expect(bootstrapMean(values, 0, 2000)).toEqual(interval);
  });
});

describe("clopperPearson", () => {
  test("matches the Python library's exact interval", () => {
    const cases: [number, number, number, number][] = [
      [48, 50, 0.8628623743960326, 0.9951185665738356],
      [50, 50, 0.9288782635358024, 1],
      [0, 20, 0, 0.16843347098308528],
      [37, 50, 0.5965523212719344, 0.8536994156034455],
      [1, 3, 0.008403758659612643, 0.9057006759497539],
    ];
    for (const [passed, total, low, high] of cases) {
      const interval = clopperPearson(passed, total);
      expect(interval.low).toBeCloseTo(low, 6);
      expect(interval.high).toBeCloseTo(high, 6);
    }
  });
});

describe("summarizeScores", () => {
  test("gives the mean, an interval and the case count", () => {
    const summary = summarizeScores([1, 0, 1, 1]);
    expect(summary.mean).toBe(0.75);
    expect(summary.cases).toBe(4);
    expect(summary.low).toBeLessThanOrEqual(0.75);
    expect(summary.high).toBeGreaterThanOrEqual(0.75);
  });
});

describe("compareScores", () => {
  const hashes = Array.from({ length: 200 }, (_, index) => `h${String(index).padStart(3, "0")}`);

  test("pairs cases by input hash and counts fixed and broken cases", () => {
    const before = [
      { inputHash: "b", score: 1 },
      { inputHash: "a", score: 0 },
      { inputHash: "c", score: 0.5 },
    ];
    const after = [
      { inputHash: "a", score: 1 },
      { inputHash: "c", score: 0.5 },
      { inputHash: "b", score: 0 },
    ];
    const result = compareScores(before, after);
    expect(result.cases).toEqual([
      { inputHash: "a", before: 0, after: 1 },
      { inputHash: "b", before: 1, after: 0 },
      { inputHash: "c", before: 0.5, after: 0.5 },
    ]);
    expect(result.difference).toBe(0);
    expect(result.fixed).toBe(1);
    expect(result.broken).toBe(1);
    expect(result.verdict).toBe("no_detectable_difference");
  });

  test("a clear improvement is better, its reverse worse", () => {
    const before = hashes.map((inputHash, index) => ({ inputHash, score: index % 2 }));
    const after = hashes.map((inputHash, index) => ({ inputHash, score: index % 5 === 0 ? 0 : 1 }));
    const better = compareScores(before, after);
    expect(better.verdict).toBe("better");
    expect(better.low).toBeGreaterThan(0);
    const worse = compareScores(after, before);
    expect(worse.verdict).toBe("worse");
    expect(worse.high).toBeLessThan(0);
  });

  test("is deterministic", () => {
    const before = hashes.map((inputHash, index) => ({ inputHash, score: (index * 7) % 3 === 0 ? 1 : 0 }));
    const after = hashes.map((inputHash, index) => ({ inputHash, score: (index * 11) % 4 === 0 ? 0 : 1 }));
    expect(compareScores(before, after)).toEqual(compareScores(before, after));
  });

  test("rejects runs that scored different case sets", () => {
    expect(() =>
      compareScores([{ inputHash: "a", score: 1 }], [{ inputHash: "b", score: 1 }]),
    ).toThrow(/different cases/);
  });
});
