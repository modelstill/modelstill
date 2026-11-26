import Link from "next/link";
import { CursorClickIcon, FileCodeIcon, LinkSimpleIcon, TerminalWindowIcon } from "@phosphor-icons/react/dist/ssr";
import { CodeBlock } from "@modelstill/ui/blocks/code-block";
import { Card, CardHeading, StatusBadge } from "@/components/dashboard/primitives";
import { API_KEYS_HREF } from "@/lib/nav";
import { API_KEY_ENV, claudeCommand, cursorConfig, mcpJsonConfig } from "@/lib/mcp";

export function ConnectPanel({ mcpUrl }: { mcpUrl: string }) {
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeading
          icon={<LinkSimpleIcon />}
          title="Server URL"
          description="Streamable HTTP. OAuth sign-in or an API key as a bearer token."
          action={<StatusBadge tone="green">MCP</StatusBadge>}
        />
        <CodeBlock label="MCP server" code={mcpUrl} className="mt-4" />
      </Card>
      <Card>
        <CardHeading
          icon={<TerminalWindowIcon />}
          title="Claude Code"
          description="Add the server, then run /mcp in Claude Code and sign in with your ModelStill email. No key is needed."
        />
        <CodeBlock label="Terminal" code={claudeCommand(mcpUrl)} className="mt-4" />
      </Card>
      <Card>
        <CardHeading icon={<FileCodeIcon />} title="Project .mcp.json" description={`For a shared project or a headless agent, check this in and give each person their own key in ${API_KEY_ENV}.`} />
        <CodeBlock label=".mcp.json" code={mcpJsonConfig(mcpUrl)} className="mt-4" />
        <Link href={API_KEYS_HREF} className="mt-3 inline-flex text-[13px] font-medium text-link hover:underline">
          Create an API key
        </Link>
      </Card>
      <Card>
        <CardHeading icon={<CursorClickIcon />} title="Cursor" description={`Put this in ~/.cursor/mcp.json or the project's .cursor/mcp.json, with ${API_KEY_ENV} set in your shell.`} />
        <CodeBlock label="mcp.json" code={cursorConfig(mcpUrl)} className="mt-4" />
      </Card>
    </div>
  );
}
