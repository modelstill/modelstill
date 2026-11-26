import { apiKey } from "@better-auth/api-key";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOTP, jwt, mcp, openAPI } from "better-auth/plugins";
import { emailAllowed } from "./allowed-emails.ts";
import { mcpOAuthOptions } from "./mcp-oauth.ts";
import { API_KEY_PREFIX, READ_PERMISSIONS } from "./permissions.ts";

export const AUTH_BASE_PATH = "/api/auth";

export type SendOtp = (email: string, otp: string) => Promise<void>;

export type AuthOptions = {
  baseURL: string;
  secret?: string;
  frontendUrl: string;
  mcpResource: string;
  trustedOrigins: string[];
  database?: BetterAuthOptions["database"];
  allowedEmails?: string[];
  requirePkce?: boolean;
  sendOtp?: SendOtp;
};

const AUTH_MODELS = [
  "user",
  "session",
  "account",
  "verification",
  "apikey",
  "oauthApplication",
  "oauthAccessToken",
  "oauthConsent",
  "jwks",
] as const;

const OTP_PATHS = new Set(["/email-otp/send-verification-otp", "/sign-in/email-otp"]);

export function inMemoryAuthDatabase() {
  return memoryAdapter(Object.fromEntries(AUTH_MODELS.map((model) => [model, []])));
}

export const logOtp: SendOtp = async (email, otp) => {
  console.info(`[auth] sign-in code for ${email}: ${otp}`);
};

function notAllowed() {
  return new APIError("FORBIDDEN", { message: "This email is not allowed to sign in", code: "EMAIL_NOT_ALLOWED" });
}

export function createAuth(options: AuthOptions) {
  const allowed = options.allowedEmails ?? [];
  const sendOtp = options.sendOtp ?? logOtp;
  return betterAuth({
    baseURL: options.baseURL,
    basePath: AUTH_BASE_PATH,
    secret: options.secret,
    trustedOrigins: options.trustedOrigins,
    database: options.database ?? inMemoryAuthDatabase(),
    user: {
      additionalFields: {
        onboardedAt: { type: "date", required: false, input: false },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (!OTP_PATHS.has(ctx.path)) return;
        const email = (ctx.body as { email?: unknown } | undefined)?.email;
        if (typeof email === "string" && !emailAllowed(email, allowed)) throw notAllowed();
      }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!emailAllowed(user.email, allowed)) throw notAllowed();
            return { data: user };
          },
        },
      },
    },
    plugins: [
      mcp(
        mcpOAuthOptions({
          frontendUrl: options.frontendUrl,
          resource: options.mcpResource,
          requirePkce: options.requirePkce ?? true,
        }),
      ),
      emailOTP({
        async sendVerificationOTP({ email, otp }) {
          if (!emailAllowed(email, allowed)) throw notAllowed();
          await sendOtp(email, otp);
        },
      }),
      openAPI(),
      apiKey({
        defaultPrefix: API_KEY_PREFIX,
        enableMetadata: true,
        rateLimit: { enabled: false },
        permissions: { defaultPermissions: READ_PERMISSIONS },
      }),
      jwt({ disableSettingJwtHeader: true }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
