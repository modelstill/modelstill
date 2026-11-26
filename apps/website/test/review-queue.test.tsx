import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ReviewQueueTable } from "../src/components/review/review-queue-table";
import type { BulkReviewResult, ReviewItem } from "../src/lib/api";

afterEach(cleanup);

function item(index: number, reviewState = "queued"): ReviewItem {
  return {
    id: `item-${index}`,
    inputHash: `hash-${String(index).padStart(3, "0")}`,
    input: { n: index },
    teacherOutputs: [
      { teacher: "teacher-a", output: { n: index } },
      { teacher: "teacher-b", output: { n: index + 1 } },
    ],
    agreement: 0.5,
    reviewState,
  };
}

const many = Array.from({ length: 30 }, (_, index) => item(index + 1));

function bulkApi(options: { missing?: string[]; fail?: boolean } = {}) {
  const calls: [string[], string][] = [];
  const api = {
    acceptReviewItems: async (ids: string[], reviewer: string): Promise<BulkReviewResult> => {
      calls.push([ids, reviewer]);
      if (options.fail) throw new Error("HTTP 500");
      const missing = options.missing ?? [];
      return { items: ids.filter((id) => !missing.includes(id)).map((id) => ({ ...many.find((entry) => entry.id === id)!, reviewState: "accepted" })), missing };
    },
  };
  return { api, calls };
}

function shownHashes(): string[] {
  return screen.getAllByTestId("data-table-row").map((row) => row.getAttribute("data-row-id")!);
}

function renderTable(props: Partial<Parameters<typeof ReviewQueueTable>[0]> = {}) {
  const { api, calls } = bulkApi();
  const onDecided = mock((_items: ReviewItem[]) => {});
  render(<ReviewQueueTable rows={many} total={many.length} api={api} reviewer="dana" activeId={null} onOpen={() => {}} onDecided={onDecided} emptyMessage="empty" {...props} />);
  return { calls, onDecided };
}

describe("review queue paging", () => {
  test("shows one page at a time and the pager moves through the queue", () => {
    renderTable();
    expect(shownHashes()).toHaveLength(25);
    expect(shownHashes()[0]).toBe("item-1");
    expect(screen.getByText(/Page 1 of 2/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(shownHashes()).toEqual(["item-26", "item-27", "item-28", "item-29", "item-30"]);
    expect(screen.getByText(/Page 2 of 2/)).toBeDefined();
    expect((screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(shownHashes()[0]).toBe("item-1");
  });

  test("the page follows the open item when J and K move past the page", () => {
    const { rerender } = render(
      <ReviewQueueTable rows={many} total={30} api={bulkApi().api} reviewer="dana" activeId={null} onOpen={() => {}} onDecided={() => {}} emptyMessage="empty" />,
    );
    rerender(<ReviewQueueTable rows={many} total={30} api={bulkApi().api} reviewer="dana" activeId="item-27" onOpen={() => {}} onDecided={() => {}} emptyMessage="empty" />);
    expect(screen.getByText(/Page 2 of 2/)).toBeDefined();
  });
});

describe("review queue selection", () => {
  test("selecting rows shows the bulk bar with the count and clear empties it", () => {
    renderTable();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select row item-1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select row item-2" }));
    expect(screen.getByText("2 selected")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByText(/selected/)).toBeNull();
  });

  test("select all picks every row on the current page only", () => {
    renderTable();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all rows" }));
    expect(screen.getByText("25 selected")).toBeDefined();
  });

  test("accepting the selection posts every waiting id once with the reviewer", async () => {
    const { calls, onDecided } = renderTable();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select row item-1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select row item-3" }));
    fireEvent.click(screen.getByRole("button", { name: "Accept 2" }));
    await waitFor(() => expect(onDecided).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([[["item-1", "item-3"], "dana"]]);
    expect(onDecided.mock.calls[0]![0].map((entry) => entry.reviewState)).toEqual(["accepted", "accepted"]);
    await waitFor(() => expect(screen.queryByText(/selected/)).toBeNull());
  });

  test("decided rows in the selection are skipped", async () => {
    const rows = [item(1), item(2, "corrected")];
    const { api, calls } = bulkApi();
    render(<ReviewQueueTable rows={rows} total={2} api={api} reviewer="dana" activeId={null} onOpen={() => {}} onDecided={() => {}} emptyMessage="empty" />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all rows" }));
    expect(screen.getByText(/1 already decided is skipped/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Accept 1" }));
    await waitFor(() => expect(calls).toEqual([[["item-1"], "dana"]]));
  });

  test("bulk accept needs a reviewer name", () => {
    renderTable({ reviewer: " " });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select row item-1" }));
    expect((screen.getByRole("button", { name: "Accept 1" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Enter your name as reviewer/)).toBeDefined();
  });

  test("a failed bulk accept keeps the selection and says why", async () => {
    const { api } = bulkApi({ fail: true });
    const onDecided = mock((_items: ReviewItem[]) => {});
    render(<ReviewQueueTable rows={many} total={30} api={api} reviewer="dana" activeId={null} onOpen={() => {}} onDecided={onDecided} emptyMessage="empty" />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select row item-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Accept 1" }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/HTTP 500/)).toBeDefined();
    expect(screen.getByText("1 selected")).toBeDefined();
    expect(onDecided).not.toHaveBeenCalled();
  });

  test("a row that leaves the view leaves the selection", () => {
    const { rerender } = render(
      <ReviewQueueTable rows={many} total={30} api={bulkApi().api} reviewer="dana" activeId={null} onOpen={() => {}} onDecided={() => {}} emptyMessage="empty" />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Select row item-1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select row item-2" }));
    rerender(<ReviewQueueTable rows={many.slice(1)} total={30} api={bulkApi().api} reviewer="dana" activeId={null} onOpen={() => {}} onDecided={() => {}} emptyMessage="empty" />);
    expect(screen.getByText("1 selected")).toBeDefined();
  });
});
