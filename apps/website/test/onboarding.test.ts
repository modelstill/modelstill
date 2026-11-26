import { describe, expect, test } from "bun:test";
import { createApiClient } from "../src/lib/api";
import { signedInDestination, toParams } from "../src/lib/auth-page";
import { docsUrl } from "../src/lib/links";
import {
  GOALS,
  needsOnboarding,
  onboardingGoal,
  ONBOARDING_STEPS,
  onboardingStep,
  pushCommands,
  specSample,
  suggestedName,
} from "../src/lib/onboarding";
import { OTP_LENGTH, sanitizeOtp } from "../src/lib/otp-code";
import { readSession } from "../src/lib/session";
import { sendCodeErrorMessage, signInErrorMessage, UNREACHABLE_MESSAGE, verifyCodeErrorMessage } from "../src/lib/sign-in-error";

const BASE = "http://api.test";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("onboarding steps", () => {
  test("runs about you, first task, API key, MCP, data and done in that order", () => {
    expect(ONBOARDING_STEPS.map((step) => step.key)).toEqual(["profile", "task", "key", "connect", "data", "done"]);
    expect(ONBOARDING_STEPS.map((step) => step.href)).toEqual([
      "/onboarding/profile",
      "/onboarding/task",
      "/onboarding/key",
      "/onboarding/connect",
      "/onboarding/data",
      "/onboarding/done",
    ]);
  });

  test("a step knows its number, the total and the next step", () => {
    expect(onboardingStep("profile")).toMatchObject({ number: 1, total: 6, next: "/onboarding/task", back: null });
    expect(onboardingStep("key")).toMatchObject({ number: 3, total: 6, next: "/onboarding/connect", back: "/onboarding/task" });
    expect(onboardingStep("data")).toMatchObject({ number: 5, total: 6, next: "/onboarding/done", back: "/onboarding/connect" });
    expect(onboardingStep("done")).toMatchObject({ number: 6, total: 6, next: "/tasks", back: "/onboarding/data" });
  });

  test("a user without onboardedAt is sent through onboarding", () => {
    expect(needsOnboarding({ id: "u", email: "a@b.co", name: "", onboardedAt: null })).toBe(true);
    expect(needsOnboarding({ id: "u", email: "a@b.co", name: "", onboardedAt: "2026-11-24T00:00:00.000Z" })).toBe(false);
  });

  test("the suggested name is the saved name, trimmed, else empty", () => {
    expect(suggestedName({ name: " Ada Lovelace ", email: "ada@x.io" })).toBe("Ada Lovelace");
    expect(suggestedName({ name: "  ", email: "ada.lovelace@x.io" })).toBe("");
  });
});

describe("the first task", () => {
  test("a known goal picks its sample task, anything else falls back to extraction", () => {
    expect(onboardingGoal("classify")).toBe("classify");
    expect(onboardingGoal("nope")).toBe("extract");
    expect(onboardingGoal(null)).toBe("extract");
    expect(GOALS.map((goal) => goal.id)).toEqual(["extract", "classify", "tag", "judge"]);
  });

  test("the sample spec names the task and its teachers, judge, gate and base model", () => {
    const spec = specSample("classify");
    expect(spec).toContain("task: ticket-router");
    expect(spec).toContain("teachers:");
    expect(spec).toContain("judge:");
    expect(spec).toContain("max_regression: 0.02");
    expect(spec).toContain("base: Qwen/Qwen3-1.7B");
  });

  test("the push commands point at the task's spec and read the key from the environment", () => {
    expect(pushCommands("ticket-router")).toEqual([
      "modelstill spec validate tasks/ticket-router/spec.yaml",
      "MODELSTILL_API_TOKEN=$MODELSTILL_API_KEY modelstill push task tasks/ticket-router/spec.yaml",
    ]);
  });
});

describe("the session", () => {
  test("carries onboardedAt from get-session", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ user: { id: "u1", email: "a@b.co", name: "A", onboardedAt: "2026-11-24T00:00:00.000Z" } })) as unknown as typeof fetch;
    expect(await readSession({ apiUrl: BASE, cookie: "x=1", fetchImpl })).toEqual({
      status: "signed-in",
      user: { id: "u1", email: "a@b.co", name: "A", onboardedAt: "2026-11-24T00:00:00.000Z" },
    });
  });
});

describe("finishing onboarding", () => {
  test("posts to /v1/me/onboarding and returns the time", async () => {
    const seen: { url: string; method: string | undefined }[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), method: init?.method });
      return jsonResponse({ onboardedAt: "2026-11-24T01:00:00.000Z" });
    }) as typeof fetch;
    expect(await createApiClient({ baseUrl: BASE, fetchImpl }).finishOnboarding()).toBe("2026-11-24T01:00:00.000Z");
    expect(seen).toEqual([{ url: `${BASE}/v1/me/onboarding`, method: "POST" }]);
  });
});

describe("an auth page for a signed-in visitor", () => {
  const user = { id: "u", email: "a@b.co", name: "" };

  test("sends a new user to onboarding and an onboarded one to next", () => {
    const params = new URLSearchParams({ next: "/connect" });
    expect(signedInDestination({ status: "signed-in", user: { ...user, onboardedAt: null } }, params, BASE)).toBe("/onboarding");
    expect(signedInDestination({ status: "signed-in", user: { ...user, onboardedAt: "2026-11-24T00:00:00.000Z" } }, params, BASE)).toBe("/connect");
  });

  test("finishes a pending MCP authorize first and stays put when signed out", () => {
    const params = new URLSearchParams({ client_id: "c", response_type: "code" });
    expect(signedInDestination({ status: "signed-in", user: { ...user, onboardedAt: null } }, params, BASE)).toBe(
      `${BASE}/api/auth/mcp/authorize?${params.toString()}`,
    );
    expect(signedInDestination({ status: "signed-out" }, params, BASE)).toBeNull();
  });

  test("search params keep repeated keys", () => {
    expect(toParams({ a: "1", b: ["2", "3"], c: undefined }).toString()).toBe("a=1&b=2&b=3");
  });
});

describe("docs links", () => {
  test("come from NEXT_PUBLIC_DOCS_URL, else the API reference", () => {
    expect(docsUrl({ NEXT_PUBLIC_DOCS_URL: "https://docs.example/" }, BASE)).toBe("https://docs.example");
    expect(docsUrl({}, BASE)).toBe(`${BASE}/docs`);
  });
});

describe("sign-in codes", () => {
  test("keep digits only, at most six", () => {
    expect(OTP_LENGTH).toBe(6);
    expect(sanitizeOtp(" 12-34 56 78")).toBe("123456");
    expect(sanitizeOtp("abc")).toBe("");
  });
});

describe("sign-in errors", () => {
  test("a known return code gets a sentence, anything else nothing", () => {
    expect(signInErrorMessage("EMAIL_NOT_ALLOWED")).toBe("This email is not allowed to sign in to ModelStill.");
    expect(signInErrorMessage("session_expired")).toBe("Your session ended. Sign in again to continue.");
    expect(signInErrorMessage(null)).toBeNull();
    expect(signInErrorMessage("<script>")).toBeNull();
  });

  test("sending a code explains a refused email and rate limits", () => {
    expect(sendCodeErrorMessage({ code: "EMAIL_NOT_ALLOWED", status: 403 })).toBe("This email is not allowed to sign in to ModelStill.");
    expect(sendCodeErrorMessage({ status: 429 })).toBe("Too many codes requested. Wait a minute and try again.");
    expect(sendCodeErrorMessage({ message: "Something odd" })).toBe("Something odd");
    expect(sendCodeErrorMessage({})).toBe("Could not send the code. Try again.");
  });

  test("verifying explains a wrong or expired code", () => {
    expect(verifyCodeErrorMessage({ code: "INVALID_OTP" })).toBe("That code is not right. Check the latest code and try again.");
    expect(verifyCodeErrorMessage({ code: "OTP_EXPIRED" })).toBe("That code has expired. Send a new one.");
    expect(verifyCodeErrorMessage({ code: "TOO_MANY_ATTEMPTS" })).toBe("Too many wrong codes. Send a new one.");
    expect(verifyCodeErrorMessage({ message: "Invalid OTP" })).toBe("Invalid OTP");
  });

  test("an API that is down says so", () => {
    expect(UNREACHABLE_MESSAGE).toBe("Could not reach the ModelStill API. Check that it is running.");
  });
});
