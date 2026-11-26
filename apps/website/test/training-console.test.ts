import { describe, expect, test } from "bun:test";
import { artifactPath, consoleEvents, formatDuration, servedSnippets } from "../src/lib/training-console";

const run = {
  key: "technographics-9256c08a-a41fcbab-s1",
  taskSlug: "technographics",
  base: "Qwen/Qwen3-4B-Instruct-2507",
  method: "sft-lora",
  status: "succeeded" as const,
  manifest: null,
  attestation: null,
  finalMetrics: { eval_loss: 0.41 },
  startedAt: "2026-11-24T10:00:00.000Z",
  finishedAt: "2026-11-24T10:48:12.000Z",
};

const series = {
  loss: [
    { step: 10, epoch: 0.1, value: 1.2 },
    { step: 20, epoch: 0.2, value: 1.0 },
  ],
  eval_loss: [
    { step: 50, epoch: 0.5, value: 0.9 },
    { step: 100, epoch: 1, value: 0.6 },
  ],
  eval_reward: [{ step: 100, epoch: 1, value: 0.8 }],
};

describe("training console", () => {
  test("starts with the run, lists each eval step and ends with the final metrics", () => {
    const events = consoleEvents(run, series);
    expect(events.map((event) => event.kind)).toEqual(["start", "train", "eval", "eval", "finish"]);
    expect(events[1]).toMatchObject({ kind: "train", values: { firstStep: 10, lastStep: 20, points: 2 } });
    expect(events[3]).toMatchObject({ kind: "eval", step: 100, values: { epoch: 1, eval_loss: 0.6, eval_reward: 0.8 } });
    expect(events[4]).toMatchObject({ kind: "finish", values: { eval_loss: 0.41 } });
  });

  test("a running run has no finish event", () => {
    expect(consoleEvents({ ...run, status: "running", finishedAt: null, finalMetrics: null }, {}).map((event) => event.kind)).toEqual(["start"]);
  });

  test("durations read in hours, minutes and seconds", () => {
    expect(formatDuration(run.startedAt, run.finishedAt)).toBe("48m 12s");
    expect(formatDuration("2026-11-24T10:00:00.000Z", "2026-11-24T12:05:00.000Z")).toBe("2h 5m");
    expect(formatDuration(run.startedAt, null)).toBeNull();
  });

  test("the artifact lives under the task with the key's suffix", () => {
    expect(artifactPath("technographics", "technographics-9256c08a-a41fcbab-s1")).toBe("artifacts/technographics/9256c08a-a41fcbab-s1");
    expect(artifactPath("t", "other-key")).toBe("artifacts/t/other-key");
  });

  test("quickstart snippets call the served name", () => {
    const snippets = servedSnippets("technographics-9256c08a-a41fcbab-s1");
    expect(snippets.map((snippet) => snippet.value)).toEqual(["python", "typescript", "curl"]);
    for (const snippet of snippets) expect(snippet.code).toContain("technographics-9256c08a-a41fcbab-s1");
  });
});
