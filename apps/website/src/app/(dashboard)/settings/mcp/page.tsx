import type { Metadata } from "next";
import { ConnectPanel } from "@/components/connect/connect-panel";
import { SettingsPage, SettingsSection } from "@/components/dashboard/layout";
import { mcpUrl } from "@/lib/mcp";

export const metadata: Metadata = { title: "Connect via MCP" };

export default function ConnectSettingsPage() {
  return (
    <SettingsPage>
      <SettingsSection title="Connect via MCP" description="Use ModelStill from Claude Code, Cursor or any MCP client. Sign in with OAuth or send an API key.">
        <ConnectPanel mcpUrl={mcpUrl()} />
      </SettingsSection>
    </SettingsPage>
  );
}
