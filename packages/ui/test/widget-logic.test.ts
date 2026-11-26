import { describe, expect, test } from "bun:test";
import { pointsDelta, relativeDelta } from "@modelstill/ui/lib/delta";
import { filledSegments, heatLevel, meterRatio, scoreTone, usageTone } from "@modelstill/ui/lib/meter";
import { highlight } from "@modelstill/ui/lib/highlight";
import { progressOf, stepStates, timelineStates } from "@modelstill/ui/lib/steps";

describe("code highlighting", () => {
  test("marks strings, keywords, flags and variables and keeps the text intact", () => {
    const code = 'curl -X POST "https://x/v1" -H "Authorization: Bearer $KEY"';
    const tokens = highlight(code);
    expect(tokens.map((token) => token.text).join("")).toBe(code);
    expect(tokens.filter((token) => token.kind === "keyword").map((token) => token.text)).toEqual(["curl"]);
    expect(tokens.filter((token) => token.kind === "flag").map((token) => token.text)).toEqual(["-X", "-H"]);
    expect(tokens.filter((token) => token.kind === "string")).toHaveLength(2);
  });

  test("a variable outside a string is its own token", () => {
    expect(highlight("echo $MODELSTILL_API_KEY")).toContainEqual({ text: "$MODELSTILL_API_KEY", kind: "variable" });
  });

  test("a dash inside a word is not a flag", () => {
    expect(highlight("ms-live").some((token) => token.kind === "flag")).toBe(false);
  });
});

describe("meter banding", () => {
  test("the ratio is clamped to zero and one", () => {
    expect(meterRatio(5, 10)).toBe(0.5);
    expect(meterRatio(-1, 10)).toBe(0);
    expect(meterRatio(12, 10)).toBe(1);
    expect(meterRatio(3, 0)).toBe(0);
    expect(meterRatio(Number.NaN, 1)).toBe(0);
  });

  test("filled segments round to the nearest segment", () => {
    expect(filledSegments(0.5, 1, 12)).toBe(6);
    expect(filledSegments(0.99, 1, 12)).toBe(12);
    expect(filledSegments(0, 1, 12)).toBe(0);
  });

  test("any value above zero lights at least one segment", () => {
    expect(filledSegments(0.001, 1, 20)).toBe(1);
  });

  test("a score is positive above the good band, brand in the fair band and a warning below it", () => {
    expect(scoreTone(0.95)).toBe("positive");
    expect(scoreTone(0.9)).toBe("positive");
    expect(scoreTone(0.72)).toBe("brand");
    expect(scoreTone(0.5)).toBe("warning");
    expect(scoreTone(72, 100)).toBe("brand");
    expect(scoreTone(0.5, 1, { good: 0.4, fair: 0.2 })).toBe("positive");
  });

  test("a missing score has no tone", () => {
    expect(scoreTone(Number.NaN)).toBe("idle");
    expect(scoreTone(null)).toBe("idle");
  });

  test("usage turns to a warning near the limit and negative at it", () => {
    expect(usageTone(10, 100)).toBe("brand");
    expect(usageTone(80, 100)).toBe("warning");
    expect(usageTone(100, 100)).toBe("negative");
    expect(usageTone(120, 100)).toBe("negative");
  });

  test("heat levels split the range evenly and keep zero apart", () => {
    expect(heatLevel(0, 100)).toBe(0);
    expect(heatLevel(1, 100)).toBe(1);
    expect(heatLevel(50, 100)).toBe(2);
    expect(heatLevel(100, 100)).toBe(4);
    expect(heatLevel(null, 100)).toBe(0);
    expect(heatLevel(5, 0)).toBe(0);
  });

  test("usage without a limit has no tone", () => {
    expect(usageTone(10, null)).toBe("idle");
  });
});

describe("delta formatting", () => {
  test("a relative fall reads as a percentage with a down direction", () => {
    const delta = relativeDelta(87.5, 100)!;
    expect(delta.magnitude).toBe("12.5%");
    expect(delta.signed).toBe("-12.5%");
    expect(delta.direction).toBe("down");
    expect(delta.tone).toBe("negative");
  });

  test("a rise is positive when higher is better and negative when lower is better", () => {
    expect(relativeDelta(110, 100)!.tone).toBe("positive");
    expect(relativeDelta(110, 100, { higherIsBetter: false })!.tone).toBe("negative");
    expect(relativeDelta(110, 100)!.signed).toBe("+10.0%");
  });

  test("no change is flat and neutral", () => {
    const delta = relativeDelta(5, 5)!;
    expect(delta.direction).toBe("flat");
    expect(delta.tone).toBe("neutral");
    expect(delta.signed).toBe("0.0%");
  });

  test("there is no relative delta without a previous value", () => {
    expect(relativeDelta(5, 0)).toBeNull();
    expect(relativeDelta(5, null)).toBeNull();
    expect(relativeDelta(null, 5)).toBeNull();
  });

  test("shares move in points", () => {
    const delta = pointsDelta(0.272, 0.38)!;
    expect(delta.signed).toBe("-10.8 pts");
    expect(delta.magnitude).toBe("10.8 pts");
    expect(delta.direction).toBe("down");
    expect(pointsDelta(0.401, 0.398)!.signed).toBe("+0.3 pts");
    expect(pointsDelta(0.2, null)).toBeNull();
  });

  test("a lower deferral share is good", () => {
    expect(pointsDelta(0.1, 0.2, { higherIsBetter: false })!.tone).toBe("positive");
  });
});

describe("step state", () => {
  test("steps before the current one are done and after it upcoming", () => {
    expect(stepStates(3, 1)).toEqual(["done", "current", "upcoming"]);
    expect(stepStates(3, 0)).toEqual(["current", "upcoming", "upcoming"]);
  });

  test("a current index past the end marks every step done", () => {
    expect(stepStates(2, 2)).toEqual(["done", "done"]);
  });

  test("the first unfinished step is current, even after a later step finished", () => {
    expect(timelineStates([true, false, true, false])).toEqual(["done", "current", "done", "upcoming"]);
    expect(timelineStates([true, true])).toEqual(["done", "done"]);
    expect(timelineStates([])).toEqual([]);
  });

  test("progress counts finished steps", () => {
    expect(progressOf([true, false, true, false])).toEqual({ done: 2, total: 4, fraction: 0.5 });
    expect(progressOf([])).toEqual({ done: 0, total: 0, fraction: 0 });
  });
});
