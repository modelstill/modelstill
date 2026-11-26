import { describe, expect, test } from "bun:test";
import { formatInterval, formatSignedInterval, intervalBarGeometry } from "../src/lib/interval";

describe("formatInterval", () => {
  test("shows the mean with its interval to two places", () => {
    expect(formatInterval({ mean: 0.8312, low: 0.7861, high: 0.8649 })).toBe("0.83 [0.79, 0.86]");
  });

  test("respects a digits option", () => {
    expect(formatInterval({ mean: 0.5, low: 0.25, high: 0.75 }, { digits: 1 })).toBe("0.5 [0.3, 0.8]");
  });

  test("shows a dash for a missing estimate", () => {
    expect(formatInterval({ mean: null, low: null, high: null })).toBe("n/a");
  });

  test("never shows a bare mean when the interval is missing", () => {
    expect(formatInterval({ mean: 0.8, low: null, high: 0.9 })).toBe("0.80 [interval missing]");
  });
});

describe("formatSignedInterval", () => {
  test("puts a sign on the difference and both bounds", () => {
    expect(formatSignedInterval({ mean: 0.04, low: -0.012, high: 0.091 })).toBe("+0.04 [-0.01, +0.09]");
  });

  test("zero has no sign", () => {
    expect(formatSignedInterval({ mean: 0, low: -0.02, high: 0.02 })).toBe("0.00 [-0.02, +0.02]");
  });
});

describe("intervalBarGeometry", () => {
  test("places the interval and mean as percentages of the domain", () => {
    expect(intervalBarGeometry({ mean: 0.5, low: 0.25, high: 0.75 })).toEqual({ left: 25, width: 50, mean: 50 });
  });

  test("clamps to the domain", () => {
    expect(intervalBarGeometry({ mean: -0.1, low: -0.3, high: 0.2 }, { min: -0.2, max: 0.2 })).toEqual({
      left: 0,
      width: 100,
      mean: 25,
    });
  });
});
