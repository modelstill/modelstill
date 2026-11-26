"use client";

import { useState } from "react";
import { CheckIcon, XIcon } from "@phosphor-icons/react";
import { Alert, AlertDescription } from "@modelstill/ui/components/alert";
import { Button } from "@modelstill/ui/components/button";
import { Spinner } from "@modelstill/ui/components/spinner";

const SCOPE_LABELS: Record<string, string> = {
  openid: "Know who you are",
  profile: "See your name",
  email: "See your email address",
  offline_access: "Stay connected after you close the app",
  "modelstill:read": "Read tasks, evals, gates, training and traffic",
  "modelstill:write": "Push results and change deployments",
};

export function scopeLabels(scopes: string): string[] {
  return scopes
    .split(/\s+/)
    .filter(Boolean)
    .map((scope) => SCOPE_LABELS[scope] ?? scope);
}

export function ConsentCard({
  clientId,
  scopes,
  decide,
  navigate,
}: {
  clientId: string;
  scopes: string;
  decide: (accept: boolean) => Promise<string>;
  navigate: (url: string) => void;
}) {
  const [pending, setPending] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const answer = async (accept: boolean) => {
    setPending(accept ? "allow" : "deny");
    setError(null);
    try {
      navigate(await decide(accept));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not record your answer");
      setPending(null);
    }
  };

  return (
    <div className="mt-8 flex flex-col gap-4">
      <p className="text-[14px] leading-5 text-muted-foreground">
        The MCP client <code className="font-mono text-xs text-foreground">{clientId}</code> wants to use ModelStill as you. It
        will be able to:
      </p>
      <ul className="divide-y divide-border/70 overflow-hidden rounded-lg bg-muted ring-1 ring-border/80">
        {scopeLabels(scopes).map((label) => (
          <li key={label} className="flex items-center gap-2.5 px-3.5 py-3 text-[13px] text-foreground">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-status-ok-bg">
              <CheckIcon aria-hidden="true" weight="bold" className="size-3 text-status-ok" />
            </span>
            <span>{label}</span>
          </li>
        ))}
      </ul>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex gap-2">
        <Button type="button" className="flex-1" disabled={pending !== null} onClick={() => void answer(true)}>
          {pending === "allow" ? <Spinner /> : <CheckIcon aria-hidden="true" />}
          Allow
        </Button>
        <Button type="button" variant="outline" className="flex-1" disabled={pending !== null} onClick={() => void answer(false)}>
          {pending === "deny" ? <Spinner /> : <XIcon aria-hidden="true" />}
          Deny
        </Button>
      </div>
    </div>
  );
}
