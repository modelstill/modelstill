import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { RequestDetail, RequestTable } from "../src/components/traffic/request-list";
import type { ServedRequest } from "../src/lib/cases-api";

const base: ServedRequest = {
  id: "1:aaaa000000000001",
  ts: "2026-11-23T10:00:00.000Z",
  task: "capitals",
  deploymentId: "dep-1",
  requestHash: "aaaa000000000001",
  mode: "serve",
  servedFrom: "student",
  deferred: false,
  reason: null,
  confidence: 0.93,
  answeredBy: "capitals-v2",
  studentModel: "capitals-v2",
  modelMatch: true,
  studentOutput: "Paris",
  cloudModel: null,
  cloudOutput: null,
  latencyMs: 80,
  studentMs: 80,
  cloudMs: null,
  costUsd: null,
  studentCostUsd: null,
  cloudCostUsd: null,
};

const deferred: ServedRequest = {
  ...base,
  id: "2:aaaa000000000002",
  requestHash: "aaaa000000000002",
  servedFrom: "cloud",
  deferred: true,
  reason: "low_confidence",
  confidence: 0.41,
  answeredBy: "cloud-large",
  studentOutput: "Lyon",
  cloudModel: "cloud-large",
  cloudOutput: "Paris",
  latencyMs: 780,
  cloudMs: 700,
  costUsd: 0.0011,
  cloudCostUsd: 0.0011,
};

describe("request table", () => {
  afterEach(cleanup);

  test("shows time, task, the answering model, latency, cost and whether it was deferred", () => {
    render(<RequestTable requests={[base, deferred]} renderDetail={() => null} footer={null} />);
    const rows = screen.getAllByTestId("data-table-row");
    expect(rows).toHaveLength(2);
    const second = within(rows[1]!);
    expect(second.getByText("2026-11-23 10:00:00 UTC")).toBeTruthy();
    expect(second.getByText("capitals")).toBeTruthy();
    expect(second.getByText("cloud-large")).toBeTruthy();
    expect(second.getByText("780 ms")).toBeTruthy();
    expect(second.getByText("$0.0011")).toBeTruthy();
    expect(second.getByText("Deferred")).toBeTruthy();
    expect(within(rows[0]!).getByText("Student")).toBeTruthy();
    expect(within(rows[0]!).getByText("n/a")).toBeTruthy();
  });
});

describe("request detail", () => {
  afterEach(cleanup);

  test("shows what is stored, both answers and why it was deferred, and says the request body is not kept", () => {
    render(<RequestDetail request={deferred} onAddToReview={async () => {}} addToDataset={null} />);
    expect(screen.getByText(/only a hash of each request/)).toBeTruthy();
    expect(screen.getByTestId("student-answer").textContent).toContain("Lyon");
    expect(screen.getByTestId("cloud-answer").textContent).toContain("Paris");
    expect(screen.getByTestId("deferral-reason").textContent).toContain("confidence 0.41 was below the threshold");
  });

  test("a request the student answered has no cloud answer and no deferral", () => {
    render(<RequestDetail request={base} onAddToReview={async () => {}} addToDataset={null} />);
    expect(screen.getByTestId("cloud-answer").textContent).toContain("No cloud answer");
    expect(screen.getByTestId("deferral-reason").textContent).toContain("Not deferred");
  });

  test("Add to review hands the request over", async () => {
    const onAddToReview = mock(async () => {});
    render(<RequestDetail request={deferred} onAddToReview={onAddToReview} addToDataset={null} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add to review" }));
    });
    expect(onAddToReview).toHaveBeenCalledWith(deferred);
  });
});
