import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReviewItemCard } from "../src/components/review/review-item-card";
import { createApiClient } from "../src/lib/api";
import type { ReviewItem } from "../src/lib/api";

const item: ReviewItem = {
  id: "item-1",
  inputHash: "hash-1",
  input: { title: "sr. eng" },
  teacherOutputs: [
    { teacher: "teacher-a", output: { title: "Senior Engineer" } },
    { teacher: "teacher-b", output: { title: "Software Engineer" } },
  ],
  agreement: 0.5,
  reviewState: "pending",
};

type Posted = { url: string; body: unknown };

function recordingApi(options: { fail?: boolean } = {}) {
  const posted: Posted[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    posted.push({ url: String(input), body });
    await gate;
    if (options.fail) return new Response(JSON.stringify({ error: "nope" }), { status: 500 });
    const state = body.verdict === "accept" ? "accepted" : "corrected";
    return new Response(JSON.stringify({ item: { ...item, teacherOutputs: {}, reviewState: state } }), { status: 200 });
  }) as typeof fetch;
  return { api: createApiClient({ baseUrl: "http://api.test", fetchImpl }), posted, release: () => release() };
}

describe("review item actions", () => {
  afterEach(cleanup);

  test("shows the input and each teacher's output", async () => {
    const { api } = recordingApi();
    render(<ReviewItemCard item={item} api={api} reviewer="dana" />);
    expect(screen.getByText("teacher-a")).toBeTruthy();
    expect(screen.getByText("teacher-b")).toBeTruthy();
    expect(screen.getByTestId("review-input").textContent).toContain("sr. eng");
  });

  test("accept posts the accept verdict with the reviewer and updates optimistically", async () => {
    const { api, posted, release } = recordingApi();
    render(<ReviewItemCard item={item} api={api} reviewer="dana" />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(screen.getByTestId("review-state").textContent).toBe("accepted");
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.url).toBe("http://api.test/v1/review-queue/item-1/decision");
    expect(posted[0]!.body).toEqual({ verdict: "accept", reviewer: "dana" });
    release();
    await waitFor(() => expect(screen.getByTestId("review-state").textContent).toBe("accepted"));
  });

  test("correct posts the parsed corrected output", async () => {
    const { api, posted, release } = recordingApi();
    render(<ReviewItemCard item={item} api={api} reviewer="dana" />);
    fireEvent.click(screen.getByRole("button", { name: "Correct" }));
    fireEvent.change(screen.getByLabelText("Corrected output (JSON)"), { target: { value: '{"title":"Senior Software Engineer"}' } });
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    expect(screen.getByTestId("review-state").textContent).toBe("corrected");
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.body).toEqual({ verdict: "correct", correctedOutput: { title: "Senior Software Engineer" }, reviewer: "dana" });
    release();
    await waitFor(() => expect(screen.getByRole("button", { name: "Accept" }).hasAttribute("disabled")).toBe(false));
  });

  test("invalid JSON is not posted", async () => {
    const { api, posted } = recordingApi();
    render(<ReviewItemCard item={item} api={api} reviewer="dana" />);
    fireEvent.click(screen.getByRole("button", { name: "Correct" }));
    fireEvent.change(screen.getByLabelText("Corrected output (JSON)"), { target: { value: "{not json" } });
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    expect(screen.getByRole("alert").textContent).toContain("not valid JSON");
    expect(posted).toHaveLength(0);
  });

  test("a failed decision rolls the optimistic state back and says why", async () => {
    const { api, release } = recordingApi({ fail: true });
    render(<ReviewItemCard item={item} api={api} reviewer="dana" />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(screen.getByTestId("review-state").textContent).toBe("accepted");
    release();
    await waitFor(() => expect(screen.getByTestId("review-state").textContent).toBe("pending"));
    expect(screen.getByRole("alert").textContent).toContain("500");
  });
});
