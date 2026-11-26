import { createHash } from "node:crypto";
import { createApp } from "../src/app.ts";
import { createAuth, type AuthOptions } from "../src/auth/index.ts";
import { createMemoryStore } from "../src/store-memory.ts";

export const ADMIN_TOKEN = "admin-token";
export const API_ORIGIN = "http://localhost:8787";
export const DASHBOARD_ORIGIN = "http://localhost:4323";
export const REDIRECT_URI = "http://localhost:9999/callback";

export function authFixture(overrides: Partial<AuthOptions> = {}) {
  const codes = new Map<string, string>();
  const auth = createAuth({
    baseURL: API_ORIGIN,
    secret: "modelstill-test-secret-0123456789abcdef",
    frontendUrl: DASHBOARD_ORIGIN,
    mcpResource: "http://localhost:3104/mcp",
    trustedOrigins: [DASHBOARD_ORIGIN],
    sendOtp: async (email, otp) => {
      codes.set(email, otp);
    },
    ...overrides,
  });
  const store = createMemoryStore();
  const app = createApp({ store, auth, apiToken: ADMIN_TOKEN, corsOrigins: [DASHBOARD_ORIGIN] });

  const call = (path: string, init: RequestInit = {}) => app.request(`${API_ORIGIN}${path}`, init);

  const json = (method: string, body: unknown, headers: Record<string, string> = {}): RequestInit => ({
    method,
    headers: { "content-type": "application/json", origin: DASHBOARD_ORIGIN, ...headers },
    body: JSON.stringify(body),
  });

  async function requestCode(email: string) {
    return call("/api/auth/email-otp/send-verification-otp", json("POST", { email, type: "sign-in" }));
  }

  async function signIn(email = "owner@example.com"): Promise<string> {
    const sent = await requestCode(email);
    if (sent.status !== 200) throw new Error(`send code failed: ${sent.status} ${await sent.text()}`);
    const signedIn = await call("/api/auth/sign-in/email-otp", json("POST", { email, otp: codes.get(email) }));
    const cookie = signedIn.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error(`sign in failed: ${signedIn.status} ${await signedIn.text()}`);
    return cookie;
  }

  async function createKey(cookie: string, permission: "read" | "write", name = "laptop") {
    const response = await call("/v1/api-keys", json("POST", { name, permission }, { cookie }));
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  async function oauthToken(cookie: string, scope: string) {
    const registered = await call(
      "/api/auth/mcp/register",
      json("POST", { redirect_uris: [REDIRECT_URI], token_endpoint_auth_method: "none", client_name: "Test MCP client" }),
    );
    const client = (await registered.json()) as { client_id: string };
    const verifier = "modelstill-test-code-verifier-0123456789abcdefghij";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const query = new URLSearchParams({
      client_id: client.client_id,
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      scope,
      state: "state-1",
      code_challenge: challenge,
      code_challenge_method: "S256",
      prompt: "consent",
    });
    const authorized = await call(`/api/auth/mcp/authorize?${query}`, { headers: { cookie } });
    const consentCode = new URL(authorized.headers.get("location")!).searchParams.get("consent_code");
    const consent = await call("/api/auth/oauth2/consent", json("POST", { accept: true, consent_code: consentCode }, { cookie }));
    const { redirectURI } = (await consent.json()) as { redirectURI: string };
    const code = new URL(redirectURI).searchParams.get("code")!;
    const token = await call("/api/auth/mcp/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: client.client_id,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      }),
    });
    return ((await token.json()) as { access_token: string }).access_token;
  }

  return { app, auth, store, codes, call, json, requestCode, signIn, createKey, oauthToken };
}

export const taskBody = { version: 1, snapshotHash: "d9c454a2", gitSha: "6256a10", spec: { task: "t" } };
