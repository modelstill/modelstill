import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConnectStep, DoneStep, KeyStep, ProfileStep, SkipSetup, TaskStep, type OnboardingDeps } from "../src/components/onboarding/steps";
import type { CreatedApiKey } from "../src/lib/api";

afterEach(cleanup);

const created: CreatedApiKey = {
  id: "k1",
  name: "Coding agent",
  key: "ms_live_onboardingsecret",
  start: "ms_liv",
  permission: "write",
  createdAt: "2026-11-24T00:00:00.000Z",
};

function deps(overrides: Partial<OnboardingDeps> = {}) {
  const calls = { names: [] as string[], keys: [] as [string, string][], finished: 0 };
  const value: OnboardingDeps = {
    saveName: async (name) => {
      calls.names.push(name);
    },
    createKey: async (name, permission) => {
      calls.keys.push([name, permission]);
      return created;
    },
    finish: async () => {
      calls.finished += 1;
    },
    ...overrides,
  };
  return { deps: value, calls };
}

describe("onboarding: about you", () => {
  test("saves a changed name and goes to the first task", async () => {
    const { deps: d, calls } = deps();
    const go = mock((_href: string) => {});
    render(<ProfileStep initialName="" goal="extract" onGoal={() => {}} deps={d} navigate={go} />);
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: " Ada " } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    await waitFor(() => expect(go).toHaveBeenCalledWith("/onboarding/task"));
    expect(calls.names).toEqual(["Ada"]);
  });

  test("an empty name is asked for and nothing is saved", async () => {
    const { deps: d, calls } = deps();
    render(<ProfileStep initialName="" goal="extract" onGoal={() => {}} deps={d} navigate={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    expect(await screen.findByText("Tell us what to call you.")).toBeDefined();
    expect(calls.names).toEqual([]);
  });

  test("picking a goal reports it", () => {
    const onGoal = mock((_goal: string) => {});
    const { deps: d } = deps();
    render(<ProfileStep initialName="Ada" goal="extract" onGoal={onGoal} deps={d} navigate={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: /Classify or route requests/ }));
    expect(onGoal).toHaveBeenCalledWith("classify");
  });
});

describe("onboarding: first task", () => {
  test("explains the spec, shows a sample for the goal and the push commands", () => {
    render(<TaskStep goal="classify" navigate={() => {}} />);
    expect(screen.getByText("labelling.teachers")).toBeDefined();
    expect(screen.getByText(/task: ticket-router/)).toBeDefined();
    expect(screen.getByText(/modelstill push task tasks\/ticket-router\/spec.yaml/)).toBeDefined();
    expect(screen.getByRole("link", { name: /Read the spec reference/ })).toBeDefined();
  });
});

describe("onboarding: API key", () => {
  test("creates a write key by default and reports it", async () => {
    const { deps: d, calls } = deps();
    const onCreated = mock((_key: CreatedApiKey) => {});
    render(<KeyStep created={null} onCreated={onCreated} deps={d} navigate={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Create API key/ }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(calls.keys).toEqual([["Coding agent", "write"]]);
  });

  test("a created key is shown once with a copy button", () => {
    const { deps: d } = deps();
    render(<KeyStep created={created} onCreated={() => {}} deps={d} navigate={() => {}} />);
    expect(screen.getByText("ms_live_onboardingsecret")).toBeDefined();
    expect(screen.getByText("Shown once")).toBeDefined();
    expect(screen.getByRole("button", { name: "Copy API key" })).toBeDefined();
  });

  test("the key can be skipped", () => {
    const { deps: d } = deps();
    const go = mock((_href: string) => {});
    render(<KeyStep created={null} onCreated={() => {}} deps={d} navigate={go} />);
    fireEvent.click(screen.getByRole("button", { name: /Skip for now/ }));
    expect(go).toHaveBeenCalledWith("/onboarding/connect");
  });
});

describe("onboarding: coding agent", () => {
  test("shows the claude mcp add command", () => {
    render(<ConnectStep mcpUrl="http://localhost:3104/mcp" created={null} navigate={() => {}} />);
    expect(screen.getByText("claude mcp add --transport http modelstill http://localhost:3104/mcp")).toBeDefined();
  });
});

describe("onboarding: done", () => {
  test("finishing marks onboarding done and opens the tasks", async () => {
    const { deps: d, calls } = deps();
    const go = mock((_href: string) => {});
    render(<DoneStep created={created} deps={d} navigate={go} />);
    fireEvent.click(screen.getByRole("button", { name: /Go to your tasks/ }));
    await waitFor(() => expect(go).toHaveBeenCalledWith("/tasks"));
    expect(calls.finished).toBe(1);
  });

  test("a failed finish stays and says why", async () => {
    const { deps: d } = deps({
      finish: async () => {
        throw new Error("API down");
      },
    });
    const go = mock((_href: string) => {});
    render(<DoneStep created={null} deps={d} navigate={go} />);
    fireEvent.click(screen.getByRole("button", { name: /Go to your tasks/ }));
    expect(await screen.findByText("API down")).toBeDefined();
    expect(go).not.toHaveBeenCalled();
  });

  test("skip setup finishes too", async () => {
    const { deps: d, calls } = deps();
    const go = mock((_href: string) => {});
    render(<SkipSetup deps={d} navigate={go} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip setup" }));
    await waitFor(() => expect(go).toHaveBeenCalledWith("/tasks"));
    expect(calls.finished).toBe(1);
  });
});
