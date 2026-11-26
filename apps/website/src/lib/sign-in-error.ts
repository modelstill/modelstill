export type AuthFailure = { message?: string | undefined; code?: string | undefined; status?: number | undefined };

export const UNREACHABLE_MESSAGE = "Could not reach the ModelStill API. Check that it is running.";

const NOT_ALLOWED = "This email is not allowed to sign in to ModelStill.";

const RETURNED: Record<string, string> = {
  EMAIL_NOT_ALLOWED: NOT_ALLOWED,
  session_expired: "Your session ended. Sign in again to continue.",
  access_denied: "Sign-in was cancelled. Try again when you are ready.",
};

const VERIFY: Record<string, string> = {
  INVALID_OTP: "That code is not right. Check the latest code and try again.",
  OTP_EXPIRED: "That code has expired. Send a new one.",
  TOO_MANY_ATTEMPTS: "Too many wrong codes. Send a new one.",
};

export function signInErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return Object.hasOwn(RETURNED, code) ? RETURNED[code]! : null;
}

export function sendCodeErrorMessage(failure: AuthFailure): string {
  if (failure.code === "EMAIL_NOT_ALLOWED") return NOT_ALLOWED;
  if (failure.status === 429) return "Too many codes requested. Wait a minute and try again.";
  return failure.message || "Could not send the code. Try again.";
}

export function verifyCodeErrorMessage(failure: AuthFailure): string {
  if (failure.code && Object.hasOwn(VERIFY, failure.code)) return VERIFY[failure.code]!;
  if (failure.status === 429) return VERIFY["TOO_MANY_ATTEMPTS"]!;
  return failure.message || "Could not check the code. Try again.";
}

export function resentCodeMessage(email: string): string {
  return `A new code is on its way to ${email}. Only the latest code works.`;
}
