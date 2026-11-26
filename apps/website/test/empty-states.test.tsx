import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ScorerGallery } from "../src/components/evals/scorer-gallery";
import { TaskEmptyState } from "../src/components/task-empty";
import { emptyPage, EMPTY_PAGES, type EmptyPageKey } from "../src/lib/empty-states";
import { runbookHref, SCORER_TEMPLATES } from "../src/lib/scorers";

describe("the command that fills each page", () => {
  const command = (key: EmptyPageKey) => emptyPage(key, "tags").command;

  test("every task page has one command and a line on what it will show", () => {
    for (const key of EMPTY_PAGES) {
      const page = emptyPage(key, "tags");
      expect(page.command.startsWith("modelstill ")).toBe(true);
      expect(page.shows.length).toBeGreaterThan(20);
      expect(page.title.length).toBeGreaterThan(0);
    }
  });

  test("the commands name the task", () => {
    expect(command("evals")).toBe("modelstill push run history.jsonl <run-id> --task tags --primary-metric <metric>");
    expect(command("training")).toContain("modelstill train run tasks/tags/spec.yaml");
    expect(command("training")).toContain("--backend remote --host <gpu-host>");
    expect(command("monitoring")).toBe("modelstill monitor canary tasks/tags/monitor.yaml --fail-on-alert");
    expect(command("gates")).toContain("modelstill push gate history.jsonl <run-id> --task tags --spec tasks/tags/spec.yaml");
    expect(command("review")).toBe("modelstill push review dataset.jsonl --task tags");
    expect(command("tasks")).toBe("modelstill push task tasks/<task>/spec.yaml");
    expect(command("datasets")).toBe("modelstill push review dataset.jsonl --task tags");
    expect(command("deployment")).toBe("modelstill serve calibrate calib.jsonl --target-error 0.05 --deployment tags.deployment.yaml");
  });

  test("a gate command never records an unmeasured check as passing", () => {
    expect(command("gates")).toContain("--flip-rate 1 --cost-ratio 9 --p95-latency-ms 99999");
  });
});

describe("task empty state", () => {
  afterEach(cleanup);

  test("shows the title, the command with a copy button and what the page will show", () => {
    render(<TaskEmptyState page={emptyPage("evals", "tags")} />);
    expect(screen.getByText("No eval runs yet")).toBeTruthy();
    expect(screen.getByTestId("empty-command").textContent).toBe(
      "modelstill push run history.jsonl <run-id> --task tags --primary-metric <metric>",
    );
    expect(screen.getByRole("button", { name: "Copy command" })).toBeTruthy();
    expect(screen.getByTestId("empty-shows").textContent).toContain("interval");
  });

  test("extra content renders under the command", () => {
    render(
      <TaskEmptyState page={emptyPage("evals", "tags")}>
        <p>gallery</p>
      </TaskEmptyState>,
    );
    expect(screen.getByText("gallery")).toBeTruthy();
  });
});

describe("scorer templates", () => {
  afterEach(cleanup);

  test("the gallery lists the five templates in order", () => {
    expect(SCORER_TEMPLATES.map((template) => template.key)).toEqual(["exact_match", "set_f1", "json_equal", "llm_judge", "pairwise"]);
  });

  test("each template links to its runbook section", () => {
    expect(runbookHref("scorers.md#exact-match", "https://git.example/modelstill")).toBe(
      "https://git.example/modelstill/blob/main/docs/runbooks/scorers.md#exact-match",
    );
    expect(runbookHref("scorers.md#exact-match", undefined)).toBeNull();
  });

  test("cards carry a status badge with an icon, the code and the runbook path", () => {
    render(<ScorerGallery repoUrl="https://git.example/modelstill" />);
    const cards = screen.getAllByTestId("scorer-template");
    expect(cards).toHaveLength(5);
    const judge = cards.find((card) => card.getAttribute("data-template") === "llm_judge")!;
    expect(judge.textContent).toContain("judge_agreement");
    expect(within(judge).getByRole("link").getAttribute("href")).toBe(
      "https://git.example/modelstill/blob/main/docs/runbooks/scorers.md#llm-judge-checked-against-people",
    );
    const pairwise = cards.find((card) => card.getAttribute("data-template") === "pairwise")!;
    const badge = within(pairwise).getByText("planned").closest("[data-slot=badge]")!;
    expect(badge.querySelector("svg")).toBeTruthy();
    const exact = cards.find((card) => card.getAttribute("data-template") === "exact_match")!;
    expect(within(exact).getByText("built in").closest("[data-slot=badge]")!.querySelector("svg")).toBeTruthy();
  });

  test("without a repository url the runbook path is shown as text", () => {
    render(<ScorerGallery repoUrl={undefined} />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getAllByText(/docs\/runbooks\/scorers\.md/).length).toBe(5);
  });
});
