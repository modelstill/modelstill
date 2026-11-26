import { describe, expect, test } from "bun:test";
import { changedFields, createAutosave, fieldText, parseFieldText, type AutosaveState } from "../src/lib/dataset-edit";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("field text", () => {
  test("a string is edited as text and anything else as JSON", () => {
    expect(fieldText("Paris")).toEqual({ format: "text", text: "Paris" });
    expect(fieldText({ city: "Paris" })).toEqual({ format: "json", text: '{\n  "city": "Paris"\n}' });
    expect(fieldText(null)).toEqual({ format: "json", text: "null" });
  });

  test("parses back by format and explains bad JSON", () => {
    expect(parseFieldText("Paris", "text")).toEqual({ ok: true, value: "Paris" });
    expect(parseFieldText('{"a":1}', "json")).toEqual({ ok: true, value: { a: 1 } });
    expect(parseFieldText("{oops", "json")).toMatchObject({ ok: false });
    expect(parseFieldText("[1]", "metadata")).toEqual({ ok: false, message: "metadata is a JSON object" });
    expect(parseFieldText('{"tags":["a"]}', "metadata")).toEqual({ ok: true, value: { tags: ["a"] } });
  });

  test("changedFields keeps only what differs from the row", () => {
    expect(changedFields({ input: "a", expected: { b: 1 }, metadata: {} }, { input: "a", expected: { b: 2 }, metadata: {} })).toEqual({
      expected: { b: 2 },
    });
  });
});

describe("autosave", () => {
  type Patch = { expected?: unknown; input?: unknown };

  function harness(respond: (patch: Patch, base: number, key: string) => Promise<number>) {
    const states: AutosaveState[] = [];
    const writes: { key: string; patch: Patch; base: number }[] = [];
    const saver = createAutosave<Patch>({
      delayMs: 5,
      base: 1,
      write: async (key, patch, base) => {
        writes.push({ key, patch, base });
        return respond(patch, base, key);
      },
      onState: (state) => states.push(state),
    });
    return { saver, states, writes };
  }

  test("waits for typing to pause, merges edits to one row, and saves once", async () => {
    const { saver, writes, states } = harness(async (_patch, base) => base + 1);
    saver.schedule("fr", { expected: "P" });
    saver.schedule("fr", { expected: "Paris" });
    saver.schedule("fr", { input: "Capital?" });
    expect(states.at(-1)).toEqual({ status: "pending" });
    await saver.flush();
    expect(writes).toEqual([{ key: "fr", patch: { expected: "Paris", input: "Capital?" }, base: 1 }]);
    expect(states.at(-1)).toEqual({ status: "saved", version: 2 });
  });

  test("saves rows one after another, each on the version the last save made", async () => {
    const { saver, writes } = harness(async (_patch, base) => {
      await wait(2);
      return base + 1;
    });
    saver.schedule("a", { expected: 1 });
    saver.schedule("b", { expected: 2 });
    await saver.flush();
    saver.schedule("a", { expected: 3 });
    await saver.flush();
    expect(writes.map((write) => [write.key, write.base])).toEqual([
      ["a", 1],
      ["b", 2],
      ["a", 3],
    ]);
  });

  test("stops on a conflict and reports the newer head", async () => {
    const { saver, states } = harness(async () => {
      throw Object.assign(new Error("conflict"), { status: 409, body: { error: "version_conflict", head: 7 } });
    });
    saver.schedule("a", { expected: 1 });
    await saver.flush();
    expect(states.at(-1)).toEqual({ status: "conflict", head: 7 });
    saver.schedule("a", { expected: 2 });
    await saver.flush();
    expect(states.at(-1)).toEqual({ status: "conflict", head: 7 });
  });

  test("keeps the edit and reports other failures", async () => {
    const { saver, states } = harness(async () => {
      throw new Error("network down");
    });
    saver.schedule("a", { expected: 1 });
    await saver.flush();
    expect(states.at(-1)).toEqual({ status: "error", message: "network down" });
  });

  test("a new base after a reload clears a conflict", async () => {
    let fail = true;
    const { saver, states, writes } = harness(async (_patch, base) => {
      if (fail) throw Object.assign(new Error("conflict"), { status: 409, body: { error: "version_conflict", head: 4 } });
      return base + 1;
    });
    saver.schedule("a", { expected: 1 });
    await saver.flush();
    fail = false;
    saver.reset(4);
    saver.schedule("a", { expected: 2 });
    await saver.flush();
    expect(writes.at(-1)).toEqual({ key: "a", patch: { expected: 2 }, base: 4 });
    expect(states.at(-1)).toEqual({ status: "saved", version: 5 });
  });
});
