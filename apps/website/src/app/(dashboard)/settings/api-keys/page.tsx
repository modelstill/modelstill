"use client";

import { useMemo } from "react";
import { SettingsPage, SettingsSection } from "@/components/dashboard/layout";
import { ApiKeysPanel } from "@/components/settings/api-keys-panel";
import { authClient } from "@/lib/auth-client";
import { createKeysApi } from "@/lib/keys";
import { useApiClient } from "@/lib/use-api";

export default function ApiKeysPage() {
  const api = useApiClient();
  const keys = useMemo(() => createKeysApi(api, authClient), [api]);
  return (
    <SettingsPage>
      <SettingsSection title="API keys" description="Keys for scripts, CI and MCP clients. Send one as Authorization: Bearer or x-api-key.">
        <ApiKeysPanel keys={keys} apiUrl={api.baseUrl} />
      </SettingsSection>
    </SettingsPage>
  );
}
