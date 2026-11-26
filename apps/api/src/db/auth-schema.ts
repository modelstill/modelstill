import { boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

const stamp = (name: string) => timestamp(name, { withTimezone: true });

export const authUser = pgTable("auth_user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: stamp("created_at").notNull(),
  updatedAt: stamp("updated_at").notNull(),
  onboardedAt: stamp("onboarded_at"),
});

export const authSession = pgTable(
  "auth_session",
  {
    id: text("id").primaryKey(),
    expiresAt: stamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: stamp("created_at").notNull(),
    updatedAt: stamp("updated_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
  },
  (table) => [index("auth_session_user_id").on(table.userId)],
);

export const authAccount = pgTable("auth_account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => authUser.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: stamp("access_token_expires_at"),
  refreshTokenExpiresAt: stamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: stamp("created_at").notNull(),
  updatedAt: stamp("updated_at").notNull(),
});

export const authVerification = pgTable(
  "auth_verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: stamp("expires_at").notNull(),
    createdAt: stamp("created_at"),
    updatedAt: stamp("updated_at"),
  },
  (table) => [index("auth_verification_identifier").on(table.identifier)],
);

export const authApikey = pgTable(
  "auth_apikey",
  {
    id: text("id").primaryKey(),
    configId: text("config_id").notNull().default("default"),
    name: text("name"),
    start: text("start"),
    prefix: text("prefix"),
    key: text("key").notNull(),
    referenceId: text("reference_id").notNull(),
    refillInterval: integer("refill_interval"),
    refillAmount: integer("refill_amount"),
    lastRefillAt: stamp("last_refill_at"),
    enabled: boolean("enabled").default(true),
    rateLimitEnabled: boolean("rate_limit_enabled").default(true),
    rateLimitTimeWindow: integer("rate_limit_time_window"),
    rateLimitMax: integer("rate_limit_max"),
    requestCount: integer("request_count").default(0),
    remaining: integer("remaining"),
    lastRequest: stamp("last_request"),
    expiresAt: stamp("expires_at"),
    createdAt: stamp("created_at").notNull(),
    updatedAt: stamp("updated_at").notNull(),
    permissions: text("permissions"),
    metadata: text("metadata"),
  },
  (table) => [index("auth_apikey_key").on(table.key), index("auth_apikey_reference_id").on(table.referenceId)],
);

export const authJwks = pgTable("auth_jwks", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: stamp("created_at").notNull(),
  expiresAt: stamp("expires_at"),
});

export const authOauthApplication = pgTable("auth_oauth_application", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  icon: text("icon"),
  metadata: text("metadata"),
  clientId: text("client_id").notNull().unique(),
  clientSecret: text("client_secret"),
  redirectUrls: text("redirect_urls").notNull(),
  type: text("type").notNull(),
  disabled: boolean("disabled").default(false),
  userId: text("user_id").references(() => authUser.id, { onDelete: "cascade" }),
  createdAt: stamp("created_at").notNull(),
  updatedAt: stamp("updated_at").notNull(),
});

export const authOauthAccessToken = pgTable("auth_oauth_access_token", {
  id: text("id").primaryKey(),
  accessToken: text("access_token").notNull().unique(),
  refreshToken: text("refresh_token").notNull().unique(),
  accessTokenExpiresAt: stamp("access_token_expires_at").notNull(),
  refreshTokenExpiresAt: stamp("refresh_token_expires_at").notNull(),
  clientId: text("client_id")
    .notNull()
    .references(() => authOauthApplication.clientId, { onDelete: "cascade" }),
  userId: text("user_id").references(() => authUser.id, { onDelete: "cascade" }),
  scopes: text("scopes").notNull(),
  createdAt: stamp("created_at").notNull(),
  updatedAt: stamp("updated_at").notNull(),
});

export const authOauthConsent = pgTable("auth_oauth_consent", {
  id: text("id").primaryKey(),
  clientId: text("client_id")
    .notNull()
    .references(() => authOauthApplication.clientId, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => authUser.id, { onDelete: "cascade" }),
  scopes: text("scopes").notNull(),
  consentGiven: boolean("consent_given").notNull(),
  createdAt: stamp("created_at").notNull(),
  updatedAt: stamp("updated_at").notNull(),
});

export const authSchema = {
  user: authUser,
  session: authSession,
  account: authAccount,
  verification: authVerification,
  apikey: authApikey,
  jwks: authJwks,
  oauthApplication: authOauthApplication,
  oauthAccessToken: authOauthAccessToken,
  oauthConsent: authOauthConsent,
};
