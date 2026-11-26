import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { OtpSignIn, type OtpAuth } from "../src/components/auth/otp-sign-in";
import { ConsentCard } from "../src/components/auth/consent-card";
import { ConnectPanel } from "../src/components/connect/connect-panel";
import { UserMenu } from "../src/components/dashboard/user-menu";
import { ApiKeysPanel } from "../src/components/settings/api-keys-panel";
import type { ApiKeyRow, KeysApi } from "../src/lib/keys";

afterEach(cleanup);

function keysApi(initial: ApiKeyRow[]) {
  let rows = [...initial];
  const calls = { created: [] as [string, string][], revoked: [] as string[] };
  const api: KeysApi = {
    list: async () => rows,
    create: async (name, permission) => {
      calls.created.push([name, permission]);
      const row: ApiKeyRow = { id: "k-new", name, start: "ms_liv", permission, createdAt: "2026-11-24T10:00:00.000Z", lastRequest: null };
      rows = [...rows, row];
      return { id: row.id, name, key: "ms_live_fullsecretvalue", start: "ms_liv", permission, createdAt: row.createdAt };
    },
    revoke: async (id) => {
      calls.revoked.push(id);
      rows = rows.filter((row) => row.id !== id);
    },
  };
  return { api, calls };
}

const existing: ApiKeyRow = {
  id: "k1",
  name: "laptop",
  start: "ms_liv",
  permission: "read",
  createdAt: "2026-11-20T10:00:00.000Z",
  lastRequest: null,
};

describe("ApiKeysPanel", () => {
  test("lists keys by name, prefix and permission", async () => {
    const { api } = keysApi([existing]);
    render(<ApiKeysPanel keys={api} apiUrl="http://localhost:8787" />);
    const row = (await screen.findByText("laptop")).closest("tr")!;
    expect(within(row).getByText(/ms_liv/)).toBeDefined();
    expect(within(row).getByText("read")).toBeDefined();
    expect(within(row).getByText("Active")).toBeDefined();
    expect(screen.getByText(/Page 1 of 1/)).toBeDefined();
  });

  test("creates a key in three steps and shows it once", async () => {
    const writeText = mock(async (_value: string) => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { api, calls } = keysApi([]);
    render(<ApiKeysPanel keys={api} apiUrl="http://localhost:8787" />);
    await screen.findByText("No API keys yet");
    fireEvent.click(screen.getAllByRole("button", { name: "Create key" })[0]!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Key name"), { target: { value: "ci" } });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Read and write" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(within(dialog).getByText("Equivalent API call")).toBeDefined();
    expect(within(dialog).getByText("/v1/api-keys")).toBeDefined();
    expect(calls.created).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Generate key" }));
    expect(await within(dialog).findByText("ms_live_fullsecretvalue")).toBeDefined();
    expect(within(dialog).getByText(/will not be shown again/i)).toBeDefined();
    expect(calls.created).toEqual([["ci", "write"]]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy new key" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("ms_live_fullsecretvalue"));
    expect(await screen.findByText("ci")).toBeDefined();
  });

  test("a key needs a name", async () => {
    const { api, calls } = keysApi([]);
    render(<ApiKeysPanel keys={api} apiUrl="http://localhost:8787" />);
    await screen.findByText("No API keys yet");
    fireEvent.click(screen.getAllByRole("button", { name: "Create key" })[0]!);
    const dialog = await screen.findByRole("dialog");
    expect((within(dialog).getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
    expect(calls.created).toEqual([]);
  });

  test("search narrows the list", async () => {
    const { api } = keysApi([existing, { ...existing, id: "k2", name: "ci-box" }]);
    render(<ApiKeysPanel keys={api} apiUrl="http://localhost:8787" />);
    await screen.findByText("laptop");
    fireEvent.change(screen.getByPlaceholderText("Search keys..."), { target: { value: "ci" } });
    expect(screen.queryByText("laptop")).toBeNull();
    expect(screen.getByText("ci-box")).toBeDefined();
  });

  test("revoking asks first, then removes the key", async () => {
    const { api, calls } = keysApi([existing]);
    render(<ApiKeysPanel keys={api} apiUrl="http://localhost:8787" />);
    await screen.findByText("laptop");
    fireEvent.click(screen.getByRole("button", { name: "Revoke laptop" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(calls.revoked).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke key" }));
    await waitFor(() => expect(calls.revoked).toEqual(["k1"]));
    expect(await screen.findByText("No API keys yet")).toBeDefined();
  });

  test("selecting keys offers a bulk revoke that asks first, then revokes each", async () => {
    const { api, calls } = keysApi([existing, { ...existing, id: "k2", name: "ci-box" }, { ...existing, id: "k3", name: "staging" }]);
    render(<ApiKeysPanel keys={api} apiUrl="http://localhost:8787" />);
    await screen.findByText("laptop");
    expect(screen.queryByRole("button", { name: /Revoke 2 keys/ })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select laptop" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select ci-box" }));
    expect(screen.getByText("2 selected")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Revoke 2 keys" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/laptop/)).toBeDefined();
    expect(within(dialog).getByText(/ci-box/)).toBeDefined();
    expect(calls.revoked).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke 2 keys" }));
    await waitFor(() => expect(calls.revoked).toEqual(["k1", "k2"]));
    await waitFor(() => expect(screen.queryByText("laptop")).toBeNull());
    expect(screen.getByText("staging")).toBeDefined();
    expect(screen.queryByText(/selected/)).toBeNull();
  });

  test("cancelling the bulk revoke keeps every key and the selection", async () => {
    const { api, calls } = keysApi([existing, { ...existing, id: "k2", name: "ci-box" }]);
    render(<ApiKeysPanel keys={api} apiUrl="http://localhost:8787" />);
    await screen.findByText("laptop");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all keys" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke 2 keys" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(calls.revoked).toEqual([]);
    expect(screen.getByText("2 selected")).toBeDefined();
  });

  test("clear empties the selection", async () => {
    const { api } = keysApi([existing]);
    render(<ApiKeysPanel keys={api} apiUrl="http://localhost:8787" />);
    await screen.findByText("laptop");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select laptop" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByText(/selected/)).toBeNull();
  });

  test("a key that fails to revoke stays selected and is named", async () => {
    const { api, calls } = keysApi([existing, { ...existing, id: "k2", name: "ci-box" }]);
    const failing: KeysApi = {
      ...api,
      revoke: async (id) => {
        if (id === "k2") throw new Error("server said no");
        await api.revoke(id);
      },
    };
    render(<ApiKeysPanel keys={failing} apiUrl="http://localhost:8787" />);
    await screen.findByText("laptop");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all keys" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke 2 keys" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Revoke 2 keys" }));
    await waitFor(() => expect(screen.queryByText("laptop")).toBeNull());
    expect(calls.revoked).toEqual(["k1"]);
    expect(screen.getByText("1 selected")).toBeDefined();
    expect(screen.getByText("ci-box")).toBeDefined();
  });

  test("shows a curl sample against this API", async () => {
    const { api } = keysApi([]);
    render(<ApiKeysPanel keys={api} apiUrl="http://localhost:8787" />);
    expect(await screen.findByText(/curl http:\/\/localhost:8787\/v1\/tasks/)).toBeDefined();
  });
});

function otpAuth(options: { verifyError?: { message?: string; code?: string }; sendError?: { message?: string; code?: string; status?: number } } = {}) {
  const calls = { sent: [] as string[], verified: [] as [string, string][] };
  const auth: OtpAuth = {
    sendCode: async (email) => {
      calls.sent.push(email);
      return { error: options.sendError ?? null };
    },
    verify: async (email, code) => {
      calls.verified.push([email, code]);
      return { error: options.verifyError ?? null };
    },
  };
  return { auth, calls };
}

async function toCodeStep(email = "a@b.co") {
  fireEvent.change(screen.getByLabelText("Work email"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "Send sign-in code" }));
  return screen.findByLabelText("Sign-in code");
}

describe("OtpSignIn", () => {
  test("sends a code to the email, then signs in with it", async () => {
    const { auth, calls } = otpAuth();
    const signedIn = mock(() => {});
    render(<OtpSignIn auth={auth} onSignedIn={signedIn} />);
    await toCodeStep(" Owner@Example.com ");
    expect(calls.sent).toEqual(["owner@example.com"]);
    expect(screen.getByText("owner@example.com")).toBeDefined();
    fireEvent.change(screen.getByLabelText("Sign-in code"), { target: { value: "123 456" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify & continue/ }));
    await waitFor(() => expect(signedIn).toHaveBeenCalledTimes(1));
    expect(calls.verified).toEqual([["owner@example.com", "123456"]]);
  });

  test("the sign-up form words its button for a new account", () => {
    const { auth } = otpAuth();
    render(<OtpSignIn auth={auth} onSignedIn={() => {}} mode="signup" />);
    expect(screen.getByRole("button", { name: "Email me a sign-in code" })).toBeDefined();
  });

  test("a wrong code shows the error and stays on the code step", async () => {
    const { auth } = otpAuth({ verifyError: { code: "INVALID_OTP", message: "Invalid OTP" } });
    const signedIn = mock(() => {});
    render(<OtpSignIn auth={auth} onSignedIn={signedIn} />);
    fireEvent.change(await toCodeStep(), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify & continue/ }));
    expect(await screen.findByText("That code is not right. Check the latest code and try again.")).toBeDefined();
    expect(signedIn).not.toHaveBeenCalled();
  });

  test("a short code asks for all six digits without calling the API", async () => {
    const { auth, calls } = otpAuth();
    render(<OtpSignIn auth={auth} onSignedIn={() => {}} />);
    fireEvent.change(await toCodeStep(), { target: { value: "123" } });
    fireEvent.submit(screen.getByLabelText("Sign-in code").closest("form")!);
    expect(await screen.findByText("Enter all 6 digits of the code.")).toBeDefined();
    expect(calls.verified).toEqual([]);
  });

  test("resend sends a new code and says so", async () => {
    const { auth, calls } = otpAuth();
    render(<OtpSignIn auth={auth} onSignedIn={() => {}} />);
    await toCodeStep();
    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    expect(await screen.findByText(/A new code is on its way to a@b.co/)).toBeDefined();
    expect(calls.sent).toEqual(["a@b.co", "a@b.co"]);
  });

  test("a different email goes back to the email step", async () => {
    const { auth } = otpAuth();
    render(<OtpSignIn auth={auth} onSignedIn={() => {}} />);
    await toCodeStep();
    fireEvent.click(screen.getByRole("button", { name: /Use a different email/ }));
    expect(await screen.findByLabelText("Work email")).toBeDefined();
  });

  test("an email that is not allowed is told so on the email step", async () => {
    const { auth } = otpAuth({ sendError: { code: "EMAIL_NOT_ALLOWED", status: 403 } });
    render(<OtpSignIn auth={auth} onSignedIn={() => {}} />);
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "x@y.z" } });
    fireEvent.click(screen.getByRole("button", { name: "Send sign-in code" }));
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByText("This email is not allowed to sign in to ModelStill.")).toBeDefined();
    expect(screen.getByLabelText("Work email")).toBeDefined();
  });

  test("an error returned in the URL is shown above the form", () => {
    const { auth } = otpAuth();
    render(<OtpSignIn auth={auth} onSignedIn={() => {}} returnedError="session_expired" />);
    expect(screen.getByText("Your session ended. Sign in again to continue.")).toBeDefined();
  });
});

describe("ConsentCard", () => {
  test("names the client and the scopes and approves", async () => {
    const decide = mock(async (_accept: boolean) => "http://localhost:9999/cb?code=abc");
    const go = mock((_url: string) => {});
    render(<ConsentCard clientId="client-1" scopes="openid modelstill:read modelstill:write" decide={decide} navigate={go} />);
    expect(screen.getByText("client-1")).toBeDefined();
    expect(screen.getByText("Read tasks, evals, gates, training and traffic")).toBeDefined();
    expect(screen.getByText("Push results and change deployments")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    await waitFor(() => expect(go).toHaveBeenCalledWith("http://localhost:9999/cb?code=abc"));
    expect(decide).toHaveBeenCalledWith(true);
  });

  test("denying sends the client its error redirect", async () => {
    const decide = mock(async (_accept: boolean) => "http://localhost:9999/cb?error=access_denied");
    const go = mock((_url: string) => {});
    render(<ConsentCard clientId="client-1" scopes="openid" decide={decide} navigate={go} />);
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    await waitFor(() => expect(go).toHaveBeenCalledWith("http://localhost:9999/cb?error=access_denied"));
    expect(decide).toHaveBeenCalledWith(false);
  });
});

describe("UserMenu", () => {
  test("shows who is signed in, opens settings and logs out", async () => {
    const signOut = mock(async () => {});
    const go = mock((_href: string) => {});
    render(<UserMenu user={{ id: "u1", email: "owner@example.com", name: "", onboardedAt: null }} onSignOut={signOut} navigate={go} />);
    expect(screen.getAllByText("owner@example.com").length).toBeGreaterThan(0);
    fireEvent.keyDown(screen.getByRole("button", { name: /owner/ }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Profile" }));
    expect(go).toHaveBeenCalledWith("/settings/profile");
    fireEvent.keyDown(screen.getByRole("button", { name: /owner/ }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Settings" }));
    expect(go).toHaveBeenCalledWith("/settings/api-keys");
    fireEvent.keyDown(screen.getByRole("button", { name: /owner/ }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Log out" }));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(go).toHaveBeenLastCalledWith("/login");
  });

  test("a saved name is shown instead of the email's local part", () => {
    render(<UserMenu user={{ id: "u1", email: "owner@example.com", name: "Ada", onboardedAt: null }} onSignOut={async () => {}} navigate={() => {}} />);
    expect(screen.getByText("Ada")).toBeDefined();
  });
});

describe("ConnectPanel", () => {
  test("shows the MCP URL, the Claude Code command and both config files", () => {
    render(<ConnectPanel mcpUrl="http://localhost:3104/mcp" />);
    expect(screen.getAllByText("http://localhost:3104/mcp").length).toBeGreaterThan(0);
    expect(screen.getByText("claude mcp add --transport http modelstill http://localhost:3104/mcp")).toBeDefined();
    expect(screen.getByText(/"type": "http"/)).toBeDefined();
    expect(screen.getByText(/Bearer \$\{MODELSTILL_API_KEY\}/)).toBeDefined();
    expect(screen.getByText(/Bearer \$\{env:MODELSTILL_API_KEY\}/)).toBeDefined();
    expect(screen.getByRole("link", { name: "Create an API key" }).getAttribute("href")).toBe("/settings/api-keys");
  });
});
