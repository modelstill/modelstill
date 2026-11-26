"use client";

import { useSearchParams } from "next/navigation";
import { Alert, AlertDescription } from "@modelstill/ui/components/alert";
import { ConsentCard } from "@/components/auth/consent-card";
import { decideConsent } from "@/lib/auth-client";

export function ConsentForm() {
  const params = useSearchParams();
  const consentCode = params.get("consent_code");
  const clientId = params.get("client_id") ?? "an MCP client";
  if (!consentCode) {
    return (
      <Alert variant="destructive">
        <AlertDescription>This consent link is missing its code. Start the connection again from your MCP client.</AlertDescription>
      </Alert>
    );
  }
  return (
    <ConsentCard
      clientId={clientId}
      scopes={params.get("scope") ?? ""}
      decide={(accept) => decideConsent(consentCode, accept)}
      navigate={(url) => window.location.assign(url)}
    />
  );
}
