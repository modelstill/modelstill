import type { mcp } from "better-auth/plugins";
import { MODELSTILL_SCOPES, OAUTH_SCOPES } from "./oauth-scopes.ts";

type McpOptions = Parameters<typeof mcp>[0];

export function dashboardPage(frontendUrl: string, path: string): string {
  return `${frontendUrl.replace(/\/+$/, "")}${path}`;
}

export function mcpOAuthOptions(input: { frontendUrl: string; resource: string; requirePkce: boolean }): McpOptions {
  const loginPage = dashboardPage(input.frontendUrl, "/login");
  return {
    loginPage,
    resource: input.resource,
    oidcConfig: {
      loginPage,
      consentPage: dashboardPage(input.frontendUrl, "/oauth/consent"),
      requirePKCE: input.requirePkce,
      scopes: [...MODELSTILL_SCOPES],
      metadata: { scopes_supported: [...OAUTH_SCOPES] },
    },
  };
}
