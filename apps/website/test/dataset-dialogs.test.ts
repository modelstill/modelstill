import { describe, expect, test } from "bun:test";
import { buildManualCase, datasetNameError } from "../src/components/datasets/dataset-dialogs";

describe("dataset name", () => {
  test("follows the API's naming rule and refuses a taken name", () => {
    expect(datasetNameError("gold-2026.v1", [])).toBeNull();
    expect(datasetNameError("", [])).toBe("give the dataset a name");
    expect(datasetNameError("has space", [])).toBe("use up to 64 letters, digits, dots, dashes and underscores");
    expect(datasetNameError("gold", ["gold"])).toBe("a dataset with this name exists");
  });
});

describe("a case typed by hand", () => {
  test("text fields stay strings and an empty id or expected is left out", () => {
    expect(buildManualCase({ id: "", input: "Capital of Peru?", expected: "", metadata: "", json: false })).toEqual({
      ok: true,
      value: { input: "Capital of Peru?", metadata: {} },
    });
  });

  test("JSON fields are parsed and errors name the field", () => {
    expect(buildManualCase({ id: " pe ", input: '{"q":"Peru"}', expected: '"Lima"', metadata: '{"tags":["sa"]}', json: true })).toEqual({
      ok: true,
      value: { id: "pe", input: { q: "Peru" }, expected: "Lima", metadata: { tags: ["sa"] } },
    });
    const bad = buildManualCase({ id: "", input: "", expected: "{", metadata: "[]", json: true });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.input).toBe("every case needs an input");
      expect(bad.errors.expected).toBeTruthy();
      expect(bad.errors.metadata).toBe("metadata is a JSON object");
    }
  });
});
