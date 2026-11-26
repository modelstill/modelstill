import { z } from "zod";

const DEFAULT_PORT = 3104;

const EnvSchema = z.object({
  MODELSTILL_API_URL: z.string().url().default("http://localhost:8787"),
  PUBLIC_URL: z.string().url().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(DEFAULT_PORT),
  MCP_UNAUTH_LIMIT: z.coerce.number().int().min(0).default(30),
  MCP_UNAUTH_WINDOW_SECONDS: z.coerce.number().int().min(1).default(60),
  MCP_DOCS_URL: z.string().url().optional(),
});

export interface Config {
  apiUrl: string;
  publicUrl: string;
  port: number;
  unauthLimit: number;
  unauthWindowMs: number;
  docsUrl: string;
}

function withoutTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function readConfig(source: Record<string, string | undefined>): Config {
  const env = EnvSchema.parse(Object.fromEntries(Object.entries(source).filter(([, value]) => value !== "")));
  const publicUrl = withoutTrailingSlash(env.PUBLIC_URL ?? `http://localhost:${env.PORT}`);
  return {
    apiUrl: withoutTrailingSlash(env.MODELSTILL_API_URL),
    publicUrl,
    port: env.PORT,
    unauthLimit: env.MCP_UNAUTH_LIMIT,
    unauthWindowMs: env.MCP_UNAUTH_WINDOW_SECONDS * 1000,
    docsUrl: env.MCP_DOCS_URL ?? `${publicUrl}/docs`,
  };
}
