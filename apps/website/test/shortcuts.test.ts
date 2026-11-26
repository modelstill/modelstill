import { describe, expect, test } from "bun:test";
import { isTypingTarget, resolveKey, SHORTCUT_GROUPS } from "../src/lib/shortcuts";

describe("go-to shortcuts", () => {
  test("g then a letter opens that page of the current task", () => {
    const first = resolveKey(null, "g", "t");
    expect(first).toEqual({ pending: "g", action: null });
    expect(resolveKey("g", "e", "t")).toEqual({ pending: null, action: { type: "go", href: "/tasks/t/evals" } });
    expect(resolveKey("g", "d", "t").action).toEqual({ type: "go", href: "/tasks/t/datasets" });
    expect(resolveKey("g", "p", "t").action).toEqual({ type: "go", href: "/tasks/t/deployment" });
  });

  test("task pages need a task; the task list and settings do not", () => {
    expect(resolveKey("g", "e", null)).toEqual({ pending: null, action: null });
    expect(resolveKey("g", "l", null).action).toEqual({ type: "go", href: "/tasks" });
    expect(resolveKey("g", "s", null).action).toEqual({ type: "go", href: "/settings/profile" });
    expect(resolveKey("g", "s", "t").action).toEqual({ type: "go", href: "/tasks/t/settings" });
  });

  test("an unknown second key drops the sequence", () => {
    expect(resolveKey("g", "z", "t")).toEqual({ pending: null, action: null });
  });

  test("question mark opens the list and the bracket toggles the sidebar", () => {
    expect(resolveKey(null, "?", null).action).toEqual({ type: "help" });
    expect(resolveKey(null, "[", "t").action).toEqual({ type: "sidebar" });
    expect(resolveKey(null, "x", "t")).toEqual({ pending: null, action: null });
  });
});

describe("typing targets", () => {
  test("inputs, text areas and editable elements swallow shortcuts", () => {
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    expect(isTypingTarget(editable)).toBe(true);
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("shortcut list", () => {
  test("no key is listed twice in one group", () => {
    for (const group of SHORTCUT_GROUPS) {
      const inGroup = group.items.map((item) => item.keys.join(" "));
      expect(new Set(inGroup).size).toBe(inGroup.length);
    }
    const keys = SHORTCUT_GROUPS.flatMap((group) => group.items.map((item) => item.keys.join(" ")));
    expect(keys).toContain("G E");
    expect(keys).toContain("⌘ K");
  });
});
