import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ResourceView } from "../src/components/states";
import { ApiError, ApiUnreachableError } from "../src/lib/api";

describe("resource view", () => {
  afterEach(cleanup);

  test("an unreachable API is named with its url and offers a retry", () => {
    let retried = 0;
    render(
      <ResourceView resource={{ status: "error", error: new ApiUnreachableError("http://localhost:8787"), reload: () => retried++ }} empty="none">
        {() => <p>data</p>}
      </ResourceView>,
    );
    expect(screen.getByRole("alert").textContent).toContain("API unreachable at http://localhost:8787");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retried).toBe(1);
  });

  test("an HTTP error shows its status", () => {
    render(
      <ResourceView resource={{ status: "error", error: new ApiError("HTTP 500 from http://x/v1/tasks", 500, "http://x/v1/tasks"), reload: () => {} }} empty="none">
        {() => <p>data</p>}
      </ResourceView>,
    );
    expect(screen.getByRole("alert").textContent).toContain("HTTP 500");
  });

  test("an empty result says so", () => {
    render(
      <ResourceView resource={{ status: "ready", data: [], reload: () => {} }} empty="No tasks yet.">
        {() => <p>data</p>}
      </ResourceView>,
    );
    expect(screen.getByText("No tasks yet.")).toBeTruthy();
    expect(screen.queryByText("data")).toBeNull();
  });

  test("a page-specific empty state replaces the generic one", () => {
    render(
      <ResourceView resource={{ status: "ready", data: [], reload: () => {} }} empty="No tasks yet." emptyState={<p>run this command</p>}>
        {() => <p>data</p>}
      </ResourceView>,
    );
    expect(screen.getByText("run this command")).toBeTruthy();
    expect(screen.queryByText("No tasks yet.")).toBeNull();
  });

  test("data renders the children", () => {
    render(
      <ResourceView resource={{ status: "ready", data: [1], reload: () => {} }} empty="No tasks yet.">
        {(rows) => <p>{rows.length} rows</p>}
      </ResourceView>,
    );
    expect(screen.getByText("1 rows")).toBeTruthy();
  });

  test("loading shows a busy placeholder", () => {
    render(
      <ResourceView resource={{ status: "loading", reload: () => {} }} empty="none">
        {() => <p>data</p>}
      </ResourceView>,
    );
    expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
  });
});
