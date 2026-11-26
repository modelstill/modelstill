import { describe, expect, test } from "bun:test";
import { changedCases, isChangedCase, orderPair, toggleSelection } from "../src/lib/compare";

const cases = [
  { inputHash: "same-pass", before: 1, after: 1 },
  { inputHash: "fixed", before: 0, after: 1 },
  { inputHash: "broken", before: true, after: false },
  { inputHash: "same-null", before: null, after: null },
  { inputHash: "new", before: null, after: 0.5 },
];

describe("changed only filter", () => {
  test("a case is changed when before and after differ", () => {
    expect(cases.map(isChangedCase)).toEqual([false, true, true, false, true]);
  });

  test("changedCases keeps only changed cases in order", () => {
    expect(changedCases(cases).map((c) => c.inputHash)).toEqual(["fixed", "broken", "new"]);
  });
});

describe("choosing two runs to compare", () => {
  const runs = [
    { id: "new", createdAt: "2026-11-21T00:00:00Z" },
    { id: "old", createdAt: "2026-11-01T00:00:00Z" },
    { id: "mid", createdAt: "2026-11-10T00:00:00Z" },
  ];

  test("the older run is before and the newer is after, whatever the click order", () => {
    expect(orderPair(runs, ["new", "old"])).toEqual({ before: "old", after: "new" });
    expect(orderPair(runs, ["old", "mid"])).toEqual({ before: "old", after: "mid" });
  });

  test("anything but two runs is no pair", () => {
    expect(orderPair(runs, ["old"])).toBeNull();
    expect(orderPair(runs, ["old", "mid", "new"])).toBeNull();
  });

  test("toggling a third run drops the oldest selection", () => {
    expect(toggleSelection(["a", "b"], "c")).toEqual(["b", "c"]);
    expect(toggleSelection(["a", "b"], "a")).toEqual(["b"]);
    expect(toggleSelection([], "a")).toEqual(["a"]);
  });
});
