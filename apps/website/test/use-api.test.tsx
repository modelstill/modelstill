import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { usePolling, useResource } from "../src/lib/use-api";

afterEach(cleanup);

function Counter({ load, every, active }: { load: () => Promise<number>; every?: number; active?: boolean }) {
  const resource = useResource(load, ["counter"]);
  usePolling(resource.refresh, every ?? 0, active ?? false);
  return (
    <div>
      <span data-testid="status">{resource.status}</span>
      <span data-testid="value">{resource.status === "ready" ? resource.data : ""}</span>
      <button type="button" onClick={resource.refresh}>
        refresh
      </button>
    </div>
  );
}

function counting(fail: (call: number) => boolean = () => false) {
  let calls = 0;
  return () => {
    calls += 1;
    return fail(calls) ? Promise.reject(new Error("down")) : Promise.resolve(calls);
  };
}

describe("useResource refresh", () => {
  test("refetches without going back to the loading state", async () => {
    const statuses: string[] = [];
    render(<Counter load={counting()} />);
    await waitFor(() => expect(screen.getByTestId("value").textContent).toBe("1"));
    act(() => screen.getByText("refresh").click());
    statuses.push(screen.getByTestId("status").textContent ?? "");
    await waitFor(() => expect(screen.getByTestId("value").textContent).toBe("2"));
    expect(statuses).toEqual(["ready"]);
  });

  test("a failed refresh keeps the data it already had", async () => {
    render(<Counter load={counting((call) => call === 2)} />);
    await waitFor(() => expect(screen.getByTestId("value").textContent).toBe("1"));
    act(() => screen.getByText("refresh").click());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId("status").textContent).toBe("ready");
    expect(screen.getByTestId("value").textContent).toBe("1");
  });
});

describe("usePolling", () => {
  test("refreshes on an interval while active", async () => {
    render(<Counter load={counting()} every={15} active />);
    await waitFor(() => expect(Number(screen.getByTestId("value").textContent)).toBeGreaterThanOrEqual(3));
  });

  test("does nothing while inactive", async () => {
    render(<Counter load={counting()} every={15} active={false} />);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(screen.getByTestId("value").textContent).toBe("1");
  });
});
