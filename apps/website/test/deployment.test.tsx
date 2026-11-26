import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ServingModeControl } from "../src/components/deployment/serving-mode-control";
import type { Deployment, DeploymentUpdate } from "../src/lib/api";
import { modeUpdate, serveBlocker } from "../src/lib/deployment";

afterEach(cleanup);

const shadow: Deployment = {
  mode: "shadow",
  studentModel: "technographics-v2",
  threshold: 0.82,
  targetError: 0.05,
  shadowSample: 0.1,
  activeFrom: "2026-11-15T00:00:00.000Z",
};

describe("modeUpdate", () => {
  test("keeps every routing field and starts the new mode now", () => {
    expect(modeUpdate(shadow, "serve")).toEqual({
      mode: "serve",
      studentModel: "technographics-v2",
      threshold: 0.82,
      targetError: 0.05,
      shadowSample: 0.1,
      activeFrom: null,
    });
  });

  test("a record without a target error cannot be rewritten from the dashboard", () => {
    expect(modeUpdate({ ...shadow, targetError: null }, "off")).toBeNull();
  });

  test("a missing shadow sample falls back to the API default", () => {
    expect(modeUpdate({ ...shadow, shadowSample: null }, "shadow")?.shadowSample).toBe(0.1);
  });
});

describe("serveBlocker", () => {
  test("serving needs a student model and a threshold", () => {
    expect(serveBlocker(shadow)).toBeNull();
    expect(serveBlocker({ ...shadow, studentModel: null })).toMatch(/student model/);
    expect(serveBlocker({ ...shadow, threshold: null })).toMatch(/calibrated threshold/);
  });
});

function deploymentApi(options: { fail?: boolean } = {}) {
  const puts: [string, DeploymentUpdate][] = [];
  const api = {
    setDeployment: async (slug: string, update: DeploymentUpdate): Promise<Deployment> => {
      puts.push([slug, update]);
      if (options.fail) throw new Error("HTTP 403");
      return { ...update, activeFrom: "2026-11-25T10:00:00.000Z" };
    },
  };
  return { api, puts };
}

function renderControl(deployment: Deployment = shadow, options: { fail?: boolean } = {}) {
  const { api, puts } = deploymentApi(options);
  const onSaved = mock((_deployment: Deployment) => {});
  render(<ServingModeControl slug="technographics" deployment={deployment} api={api} onSaved={onSaved} />);
  return { puts, onSaved };
}

describe("ServingModeControl", () => {
  test("shows the current mode, threshold, shadow sample and when the proxy picks a change up", () => {
    renderControl();
    expect(screen.getByRole("radio", { name: "shadow" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("0.82")).toBeDefined();
    expect(screen.getByText("10.0%")).toBeDefined();
    expect(screen.getByText(/the proxy picks this up within its reload interval/i)).toBeDefined();
  });

  test("turning serving off saves at once", async () => {
    const { puts, onSaved } = renderControl();
    fireEvent.click(screen.getByRole("radio", { name: "off" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(puts).toEqual([["technographics", { ...modeUpdate(shadow, "off")! }]]);
    expect(onSaved.mock.calls[0]![0].mode).toBe("off");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  test("moving to serve asks first and saves only on confirm", async () => {
    const { puts, onSaved } = renderControl();
    fireEvent.click(screen.getByRole("radio", { name: "serve" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/technographics-v2/)).toBeDefined();
    expect(within(dialog).getByText(/0\.82/)).toBeDefined();
    expect(puts).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Serve the student" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(puts[0]![1].mode).toBe("serve");
  });

  test("cancelling serve changes nothing", async () => {
    const { puts } = renderControl();
    fireEvent.click(screen.getByRole("radio", { name: "serve" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(puts).toEqual([]);
    expect(screen.getByRole("radio", { name: "shadow" }).getAttribute("aria-checked")).toBe("true");
  });

  test("serve is disabled without a calibrated threshold and says why", () => {
    renderControl({ ...shadow, threshold: null });
    expect((screen.getByRole("radio", { name: "serve" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/needs a calibrated threshold/)).toBeDefined();
  });

  test("a refused change keeps the stored mode and says why", async () => {
    const { onSaved } = renderControl(shadow, { fail: true });
    fireEvent.click(screen.getByRole("radio", { name: "off" }));
    expect((await screen.findByRole("alert")).textContent).toContain("HTTP 403");
    expect(screen.getByRole("radio", { name: "shadow" }).getAttribute("aria-checked")).toBe("true");
    expect(onSaved).not.toHaveBeenCalled();
  });
});
