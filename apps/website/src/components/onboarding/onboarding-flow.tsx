"use client";

import { useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { DistilScene } from "@/components/auth/distil-scene";
import { authClient } from "@/lib/auth-client";
import { claudeCommand } from "@/lib/mcp";
import { goalFor, onboardingStep, pushCommands, type OnboardingStepKey } from "@/lib/onboarding";
import type { SessionUser } from "@/lib/session";
import { useApiClient } from "@/lib/use-api";
import { DataStep } from "./data-step";
import { OnboardingSplit } from "./onboarding-split";
import { useOnboarding } from "./onboarding-state";
import { ConnectStep, DoneStep, KeyStep, ProfileStep, SkipSetup, TaskStep, type OnboardingDeps } from "./steps";
import { TerminalLine, TerminalPanel } from "./terminal";

const COPY: Record<OnboardingStepKey, { title: string; sub: string; caption: string }> = {
  profile: {
    title: "Welcome to ModelStill.",
    sub: "Pick the first task you want to gate and tell us your name. Every step can be redone later.",
    caption: "Know a model change is safe before you ship it.",
  },
  task: {
    title: "Create your first task.",
    sub: "A task is one YAML spec: the prompt you run today, what a right answer is, and how the small model must score to ship.",
    caption: "One spec per task, versioned by its hash.",
  },
  key: {
    title: "Create an API key.",
    sub: "Scripts, CI and coding agents send it as a bearer token. It is shown once.",
    caption: "Keys start with ms_live_ and can be revoked any time.",
  },
  connect: {
    title: "Connect your coding agent.",
    sub: "ModelStill speaks MCP, so Claude Code, Cursor or any MCP client can read your tasks and push results.",
    caption: "Your agent labels, trains and gates. You review.",
  },
  data: {
    title: "Bring in your data.",
    sub: "Connect the gateway, push a task and import history.",
    caption: "Past calls become the first eval set.",
  },
  done: {
    title: "You're all set.",
    sub: "Your tasks, evals, gates and training runs live in the dashboard.",
    caption: "Ship it only when the gate says so.",
  },
};

function Aside({ step, mcpUrl, slug }: { step: OnboardingStepKey; mcpUrl: string; slug: string }) {
  let scene: ReactNode = <DistilScene />;
  if (step === "task" || step === "key") {
    const [validate, push] = pushCommands(slug);
    scene = (
      <TerminalPanel title={`~/repo/tasks/${slug}`}>
        <TerminalLine prompt>{validate}</TerminalLine>
        <TerminalLine tone="ok">spec ok · hash d9c454a2</TerminalLine>
        <TerminalLine prompt>{push}</TerminalLine>
        <TerminalLine tone="ok">registered {slug} v1</TerminalLine>
        <TerminalLine tone="quiet">open the dashboard to label, train and gate it</TerminalLine>
      </TerminalPanel>
    );
  }
  if (step === "connect") {
    scene = (
      <TerminalPanel title="claude">
        <TerminalLine prompt>{claudeCommand(mcpUrl)}</TerminalLine>
        <TerminalLine tone="ok">Added HTTP MCP server modelstill</TerminalLine>
        <TerminalLine prompt>claude</TerminalLine>
        <TerminalLine tone="quiet">&gt; /mcp</TerminalLine>
        <TerminalLine tone="ok">modelstill · connected · 14 tools</TerminalLine>
        <TerminalLine tone="quiet">&gt; Push tasks/{slug}/spec.yaml and start labelling</TerminalLine>
      </TerminalPanel>
    );
  }
  return scene;
}

export function OnboardingFlow({ step, user, mcpUrl }: { step: OnboardingStepKey; user: SessionUser | null; mcpUrl: string }) {
  const router = useRouter();
  const api = useApiClient();
  const { createdKey, setCreatedKey, goal, setGoal } = useOnboarding();
  const position = onboardingStep(step);
  const navigate = (href: string) => router.push(href);

  const deps = useMemo<OnboardingDeps>(
    () => ({
      saveName: async (name) => {
        const { error } = await authClient.updateUser({ name });
        if (error) throw new Error(error.message ?? "Could not save your name.");
      },
      createKey: (name, permission) => api.createApiKey(name, permission),
      finish: async () => {
        await api.finishOnboarding();
        router.refresh();
      },
    }),
    [api, router],
  );

  if (step === "data") return <DataStep navigate={navigate} />;

  let body: ReactNode;
  if (step === "profile") {
    body = <ProfileStep initialName={user?.name ?? ""} goal={goal} onGoal={setGoal} deps={deps} navigate={navigate} />;
  } else if (step === "task") {
    body = <TaskStep goal={goal} navigate={navigate} />;
  } else if (step === "key") {
    body = <KeyStep created={createdKey} onCreated={setCreatedKey} deps={deps} navigate={navigate} />;
  } else if (step === "connect") {
    body = <ConnectStep mcpUrl={mcpUrl} created={createdKey} navigate={navigate} />;
  } else {
    body = <DoneStep created={createdKey} deps={deps} navigate={navigate} />;
  }

  return (
    <OnboardingSplit
      step={position.number}
      total={position.total}
      title={COPY[step].title}
      sub={COPY[step].sub}
      skip={step === "done" ? undefined : <SkipSetup deps={deps} navigate={navigate} />}
      headline={COPY[step].caption}
      aside={<Aside step={step} mcpUrl={mcpUrl} slug={goalFor(goal).slug} />}
    >
      {body}
    </OnboardingSplit>
  );
}
