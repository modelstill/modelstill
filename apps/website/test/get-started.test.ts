import { describe, expect, test } from "bun:test";
import { dataSync, setupSteps, showSetupIntro, visibleTasks } from "../src/lib/get-started";

describe("setup intro", () => {
  test("opens on the first run only, before any task and until dismissed", () => {
    expect(showSetupIntro([], false)).toBe(true);
    expect(showSetupIntro([], true)).toBe(false);
    expect(showSetupIntro(null, false)).toBe(false);
    expect(showSetupIntro([{ slug: "a" }], false)).toBe(false);
  });
});

describe("data sync", () => {
  test("starts at the gateway with nothing synced", () => {
    expect(dataSync({ tasks: [], evalRuns: 0 }).map((step) => step.state)).toEqual(["current", "upcoming", "upcoming", "upcoming"]);
  });

  test("a pushed task without traffic waits on the gateway", () => {
    const states = dataSync({ tasks: [{ slug: "a", mode: "off", deferralShare: null, lastGatePassed: null }], evalRuns: 0 }).map((step) => step.state);
    expect(states).toEqual(["current", "done", "upcoming", "upcoming"]);
  });

  test("everything in place marks the workspace synced", () => {
    const steps = dataSync({ tasks: [{ slug: "a", mode: "shadow", deferralShare: 0.1, lastGatePassed: null }], evalRuns: 2 });
    expect(steps.map((step) => step.state)).toEqual(["done", "done", "done", "done"]);
    expect(steps.at(-1)!.key).toBe("synced");
  });
});

const task = (slug: string, extra: Partial<{ mode: "off" | "shadow" | "serve"; deferralShare: number | null; lastGatePassed: boolean | null }> = {}) => ({
  slug,
  mode: "off" as const,
  deferralShare: null,
  lastGatePassed: null,
  ...extra,
});

describe("setup steps", () => {
  test("nothing is done before the first task", () => {
    expect(setupSteps([]).map((step) => step.done)).toEqual([false, false, false, false]);
    expect(setupSteps(null).map((step) => step.done)).toEqual([false, false, false, false]);
  });

  test("each step reads from the tasks", () => {
    const steps = setupSteps([task("a", { deferralShare: 0.2, lastGatePassed: false }), task("b", { mode: "shadow" })]);
    expect(steps.map((step) => [step.key, step.done])).toEqual([
      ["task", true],
      ["traffic", true],
      ["gate", true],
      ["serve", false],
    ]);
  });

  test("serving counts only a student that answers live", () => {
    expect(setupSteps([task("a", { mode: "serve" })]).find((step) => step.key === "serve")!.done).toBe(true);
  });
});

describe("visible tasks", () => {
  const tasks = ["a", "b", "c", "d", "e"].map((slug) => task(slug));

  test("folds the list after the limit", () => {
    const view = visibleTasks(tasks, { expanded: false, active: null, limit: 3 });
    expect(view.shown.map((entry) => entry.slug)).toEqual(["a", "b", "c"]);
    expect(view.hidden).toBe(2);
  });

  test("keeps the active task visible when folded", () => {
    const view = visibleTasks(tasks, { expanded: false, active: "e", limit: 3 });
    expect(view.shown.map((entry) => entry.slug)).toEqual(["a", "b", "c", "e"]);
    expect(view.hidden).toBe(1);
  });

  test("shows every task when expanded", () => {
    const view = visibleTasks(tasks, { expanded: true, active: null, limit: 3 });
    expect(view.shown).toHaveLength(5);
    expect(view.hidden).toBe(0);
  });
});
