import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { AlertStatusBadge, ReviewStateBadge, SeverityBadge } from "../src/components/badges";
import { applySelection, caseChange } from "../src/lib/compare";
import { breadcrumbs } from "../src/lib/nav";
import { reviewSummary } from "../src/lib/review";

describe("breadcrumbs", () => {
  test("the task list is a single crumb", () => {
    expect(breadcrumbs("/tasks")).toEqual([{ label: "Tasks" }]);
  });

  test("a task overview links back to the list", () => {
    expect(breadcrumbs("/tasks/t")).toEqual([{ label: "Tasks", href: "/tasks" }, { label: "t" }]);
  });

  test("compare sits under evals under the task", () => {
    expect(breadcrumbs("/tasks/t/evals/compare")).toEqual([
      { label: "Tasks", href: "/tasks" },
      { label: "t", href: "/tasks/t" },
      { label: "Evals", href: "/tasks/t/evals" },
      { label: "Compare" },
    ]);
  });

  test("a train run sits under training under the task", () => {
    expect(breadcrumbs("/tasks/t/training/t-9256c08a-s1")).toEqual([
      { label: "Tasks", href: "/tasks" },
      { label: "t", href: "/tasks/t" },
      { label: "Training", href: "/tasks/t/training" },
      { label: "t-9256c08a-s1" },
    ]);
  });

});

describe("selecting runs in a table", () => {
  test("a newly checked run is added and a third drops the oldest", () => {
    expect(applySelection([], ["a"])).toEqual(["a"]);
    expect(applySelection(["a", "b"], ["a", "b", "c"])).toEqual(["b", "c"]);
  });

  test("unchecking removes the run", () => {
    expect(applySelection(["a", "b"], ["b"])).toEqual(["b"]);
  });

  test("select all keeps at most two", () => {
    expect(applySelection([], ["a", "b", "c"])).toEqual(["b", "c"]);
  });
});

describe("case change", () => {
  test("numeric and boolean changes are fixed or broken", () => {
    expect(caseChange({ before: 0, after: 1 })).toBe("fixed");
    expect(caseChange({ before: true, after: false })).toBe("broken");
    expect(caseChange({ before: 1, after: 1 })).toBe("same");
    expect(caseChange({ before: null, after: "x" })).toBe("changed");
  });
});

describe("review summary", () => {
  test("counts states", () => {
    const items = [{ reviewState: "pending" }, { reviewState: "pending" }, { reviewState: "accepted" }, { reviewState: "corrected" }];
    expect(reviewSummary(items)).toEqual({ total: 4, pending: 2, decided: 2 });
  });

  test("queued items wait for a reviewer like pending ones", () => {
    expect(reviewSummary([{ reviewState: "queued" }, { reviewState: "accepted" }])).toEqual({ total: 2, pending: 1, decided: 1 });
  });
});

describe("badges", () => {
  afterEach(cleanup);

  test("severity and review state use shadcn badges with a variant", () => {
    render(
      <>
        <SeverityBadge severity="critical" />
        <ReviewStateBadge state="accepted" />
        <AlertStatusBadge ackedAt={null} />
      </>,
    );
    const variant = (text: string) => screen.getByText(text).closest("[data-slot=badge]")?.getAttribute("data-variant");
    expect(variant("critical")).toBe("danger");
    expect(variant("accepted")).toBe("success");
    expect(variant("open")).toBe("warning");
  });
});
