import { apiBaseUrl } from "./api";

export function docsUrl(
  env: Record<string, string | undefined> = { NEXT_PUBLIC_DOCS_URL: process.env.NEXT_PUBLIC_DOCS_URL },
  api: string = apiBaseUrl(),
): string {
  const configured = env["NEXT_PUBLIC_DOCS_URL"];
  return configured ? configured.replace(/\/+$/, "") : `${api.replace(/\/+$/, "")}/docs`;
}

export const DOCS_URL = docsUrl();
