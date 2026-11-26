"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowSquareOutIcon,
  BracketsCurlyIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  CubeIcon,
  FileTextIcon,
  FunnelIcon,
  KeyIcon,
  ListChecksIcon,
  ScalesIcon,
  TagIcon,
  TreeStructureIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { CodeBlock } from "@modelstill/ui/blocks/code-block";
import { Avatar, AvatarFallback } from "@modelstill/ui/components/avatar";
import { Button } from "@modelstill/ui/components/button";
import { Input } from "@modelstill/ui/components/input";
import { Label } from "@modelstill/ui/components/label";
import { ToggleGroup, ToggleGroupItem } from "@modelstill/ui/components/toggle-group";
import { cn } from "@modelstill/ui/lib/utils";
import { CopyButton } from "@/components/motion/copy-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/motion/tabs";
import type { CreatedApiKey, KeyPermission } from "@/lib/api";
import { DOCS_URL } from "@/lib/links";
import { API_KEY_ENV, claudeCommand, mcpJsonConfig } from "@/lib/mcp";
import { goalFor, GOALS, onboardingStep, pushCommands, specSample, type OnboardingGoal } from "@/lib/onboarding";

export type OnboardingDeps = {
  saveName: (name: string) => Promise<void>;
  createKey: (name: string, permission: KeyPermission) => Promise<CreatedApiKey>;
  finish: () => Promise<void>;
};

const FIELD_LABEL = "block text-[13px] leading-4 font-medium text-muted-foreground";
const FIELD =
  "h-10 rounded-md border border-border bg-card px-3 text-[14px] text-foreground shadow-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25";
const CHOICE_ON = "ring-primary bg-primary/[0.06] text-foreground hover:bg-primary/[0.06] hover:text-foreground";
const CHOICE_OFF = "ring-border bg-card text-foreground hover:bg-muted hover:text-foreground";
const PRIMARY = "h-10 gap-1.5 rounded-md px-4 text-[14px] font-medium";

const GOAL_ICONS: Record<OnboardingGoal, ReactNode> = {
  extract: <BracketsCurlyIcon weight="fill" />,
  classify: <FunnelIcon weight="fill" />,
  tag: <TagIcon weight="fill" />,
  judge: <ScalesIcon weight="fill" />,
};

function Pending({ label }: { label: string }) {
  return (
    <>
      {label}
      <CircleNotchIcon aria-hidden="true" className="animate-spin" />
    </>
  );
}

function StepFooter({ back, onBack, children }: { back: string | null; onBack: (href: string) => void; children: ReactNode }) {
  return (
    <div className="mt-8 flex items-center justify-between gap-3">
      {back ? (
        <Button type="button" variant="ghost" onClick={() => onBack(back)} className="h-10 gap-1.5 px-3 text-[14px] font-normal text-muted-foreground">
          <ArrowLeftIcon aria-hidden="true" />
          Back
        </Button>
      ) : (
        <span />
      )}
      {children}
    </div>
  );
}

export function ProfileStep({
  initialName,
  goal,
  onGoal,
  deps,
  navigate,
}: {
  initialName: string;
  goal: OnboardingGoal;
  onGoal: (goal: OnboardingGoal) => void;
  deps: OnboardingDeps;
  navigate: (href: string) => void;
}) {
  const nameId = useId();
  const [name, setName] = useState(initialName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initial = name.trim().charAt(0).toUpperCase() || "M";

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Tell us what to call you.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      if (trimmed !== initialName.trim()) await deps.saveName(trimmed);
      navigate(onboardingStep("profile").next);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save your name.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div role="radiogroup" aria-label="What will you distil first?" className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {GOALS.map((option) => {
          const selected = goal === option.id;
          return (
            <Button
              key={option.id}
              type="button"
              variant="outline"
              role="radio"
              aria-checked={selected}
              onClick={() => onGoal(option.id)}
              className={cn(
                "h-auto w-full justify-start gap-3 rounded-[14px] border-0 p-1.5 pr-3 text-left text-[13px] leading-4 font-medium whitespace-normal shadow-none ring-1",
                selected ? CHOICE_ON : CHOICE_OFF,
              )}
            >
              <span aria-hidden="true" className={cn("grid size-10 shrink-0 place-items-center rounded-md text-white [&>svg]:size-[18px]", option.art)}>
                {GOAL_ICONS[option.id]}
              </span>
              <span className="min-w-0 flex-1">{option.label}</span>
              {selected && <CheckCircleIcon aria-hidden="true" weight="fill" className="size-[18px] shrink-0 text-primary" />}
            </Button>
          );
        })}
      </div>

      <div className="flex items-center gap-4">
        <Avatar className="size-12 shrink-0 rounded-md border border-border">
          <AvatarFallback className="rounded-md bg-primary/12 text-[18px] font-medium text-primary">{initial}</AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <Label htmlFor={nameId} className={FIELD_LABEL}>
            Your name
          </Label>
          <Input
            id={nameId}
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ada Lovelace"
            className={cn(FIELD, "mt-1.5 w-full")}
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="text-[13px] text-negative">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending} className={PRIMARY}>
          {pending ? (
            <Pending label="Saving" />
          ) : (
            <>
              Continue
              <ArrowRightIcon aria-hidden="true" />
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

const SPEC_PARTS: { icon: ReactNode; name: string; text: string }[] = [
  { icon: <FileTextIcon />, name: "instruction", text: "The prompt the cloud model runs today." },
  { icon: <ListChecksIcon />, name: "requirements", text: "What a right answer means, each with a priority." },
  { icon: <UsersThreeIcon />, name: "labelling.teachers", text: "Two cloud models label your logged calls; disagreements go to a person." },
  { icon: <ScalesIcon />, name: "eval.gate", text: "A judge from another family scores it; the gate decides if it ships." },
  { icon: <CubeIcon />, name: "train.base", text: "The small open model you will own, trained with several seeds." },
];

export function TaskStep({ goal, navigate }: { goal: OnboardingGoal; navigate: (href: string) => void }) {
  const step = onboardingStep("task");
  const slug = goalFor(goal).slug;
  return (
    <div>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {SPEC_PARTS.map((part) => (
          <li key={part.name} className="flex items-start gap-3 px-4 py-2.5">
            <span aria-hidden="true" className="mt-0.5 text-muted-foreground [&>svg]:size-4">
              {part.icon}
            </span>
            <span className="min-w-0 text-[13.5px]">
              <code className="font-mono text-[12.5px] text-foreground">{part.name}</code>
              <span className="block text-muted-foreground">{part.text}</span>
            </span>
          </li>
        ))}
      </ul>
      <CodeBlock label={`tasks/${slug}/spec.yaml`} code={specSample(goal)} className="mt-4 [&_pre]:max-h-56" />
      <CodeBlock label="Terminal" code={pushCommands(slug).join("\n")} className="mt-3" />
      <a href={DOCS_URL} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-link hover:underline">
        Read the spec reference
        <ArrowSquareOutIcon aria-hidden="true" className="size-4" />
      </a>
      <StepFooter back={step.back} onBack={navigate}>
        <Button type="button" onClick={() => navigate(step.next)} className={PRIMARY}>
          Continue
          <ArrowRightIcon aria-hidden="true" />
        </Button>
      </StepFooter>
    </div>
  );
}

export function CreatedKeyCard({ created }: { created: CreatedApiKey }) {
  return (
    <div className="dash-wash rounded-xl border border-border p-3">
      <div className="flex items-center gap-2 rounded-lg bg-card p-1.5 pl-2 shadow-[0_1px_2px_rgba(16,16,24,0.06)]">
        <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-primary/12 px-2 text-[13px] leading-4 font-medium text-brand-text">
          <KeyIcon aria-hidden="true" weight="fill" className="size-3.5" />
          API key
        </span>
        <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[13px] whitespace-nowrap text-foreground">{created.key}</code>
        <CopyButton content={created.key} label="Copy key" variant="outline" aria-label="Copy API key" className="h-8 w-auto shrink-0 gap-1.5 px-2.5 text-[13px] shadow-none" />
      </div>
      <p className="mt-2.5 flex items-center gap-2 px-1 text-[13px] leading-4 text-muted-foreground">
        <span className="inline-flex h-5 items-center rounded-sm bg-status-warn-bg px-1.5 text-[13px] leading-4 font-medium text-status-warn">Shown once</span>
        Store it as {API_KEY_ENV}.
      </p>
    </div>
  );
}

export function KeyStep({
  created,
  onCreated,
  deps,
  navigate,
}: {
  created: CreatedApiKey | null;
  onCreated: (key: CreatedApiKey) => void;
  deps: OnboardingDeps;
  navigate: (href: string) => void;
}) {
  const step = onboardingStep("key");
  const nameId = useId();
  const [name, setName] = useState("Coding agent");
  const [permission, setPermission] = useState<KeyPermission>("write");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      onCreated(await deps.createKey(name.trim(), permission));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not create the key.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      {created ? (
        <CreatedKeyCard created={created} />
      ) : (
        <form onSubmit={create} className="space-y-5">
          <div>
            <Label htmlFor={nameId} className={FIELD_LABEL}>
              Key name
            </Label>
            <Input id={nameId} value={name} maxLength={32} onChange={(event) => setName(event.target.value)} className={cn(FIELD, "mt-1.5 w-full")} />
          </div>
          <div>
            <span className={FIELD_LABEL}>Permission</span>
            <ToggleGroup
              type="single"
              variant="outline"
              value={permission}
              onValueChange={(value) => value && setPermission(value as KeyPermission)}
              aria-label="Permission"
              className="mt-1.5"
            >
              <ToggleGroupItem value="write" className="h-9 px-3 text-[13px]">
                Read and write
              </ToggleGroupItem>
              <ToggleGroupItem value="read" className="h-9 px-3 text-[13px]">
                Read only
              </ToggleGroupItem>
            </ToggleGroup>
            <p className="mt-2 text-[12.5px] text-muted-foreground">Pushing a task, runs and gates needs write.</p>
          </div>
          {error && (
            <p role="alert" className="text-[13px] text-negative">
              {error}
            </p>
          )}
          <Button type="submit" disabled={pending || !name.trim()} className={PRIMARY}>
            {pending ? (
              <Pending label="Creating key" />
            ) : (
              <>
                <KeyIcon aria-hidden="true" />
                Create API key
              </>
            )}
          </Button>
        </form>
      )}
      <StepFooter back={step.back} onBack={navigate}>
        <Button type="button" variant={created ? "default" : "outline"} onClick={() => navigate(step.next)} className={PRIMARY}>
          {created ? "Continue" : "Skip for now"}
          <ArrowRightIcon aria-hidden="true" />
        </Button>
      </StepFooter>
    </div>
  );
}

export function ConnectStep({ mcpUrl, created, navigate }: { mcpUrl: string; created: CreatedApiKey | null; navigate: (href: string) => void }) {
  const step = onboardingStep("connect");
  return (
    <div>
      <Tabs defaultValue="claude">
        <TabsList>
          <TabsTrigger value="claude" className="text-[13px]">
            Claude Code
          </TabsTrigger>
          <TabsTrigger value="project" className="text-[13px]">
            Project .mcp.json
          </TabsTrigger>
        </TabsList>
        <TabsContent value="claude" className="mt-4 space-y-3">
          <p className="text-[13.5px] text-muted-foreground">
            Add the server, then run <code className="font-mono text-foreground">/mcp</code> in Claude Code and sign in with this email. No key is needed.
          </p>
          <CodeBlock label="Terminal" code={claudeCommand(mcpUrl)} />
        </TabsContent>
        <TabsContent value="project" className="mt-4 space-y-3">
          <p className="text-[13.5px] text-muted-foreground">
            For a shared repo or a headless agent, check this in and give each person their own key in {API_KEY_ENV}.
          </p>
          {created && <CodeBlock label="Shell" code={`export ${API_KEY_ENV}=${created.key}`} />}
          <CodeBlock label=".mcp.json" code={mcpJsonConfig(mcpUrl)} />
        </TabsContent>
      </Tabs>
      <StepFooter back={step.back} onBack={navigate}>
        <Button type="button" onClick={() => navigate(step.next)} className={PRIMARY}>
          Continue
          <ArrowRightIcon aria-hidden="true" />
        </Button>
      </StepFooter>
    </div>
  );
}

function DoneRow({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2.5 px-3.5 py-3 text-[13px] text-foreground">
      {done ? (
        <CheckCircleIcon aria-hidden="true" weight="fill" className="size-5 shrink-0 text-status-ok" />
      ) : (
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-card ring-1 ring-border">
          <span className="size-1.5 rounded-full bg-muted-foreground" />
        </span>
      )}
      <span className={done ? undefined : "text-muted-foreground"}>{children}</span>
    </li>
  );
}

export function DoneStep({ created, deps, navigate }: { created: CreatedApiKey | null; deps: OnboardingDeps; navigate: (href: string) => void }) {
  const step = onboardingStep("done");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enter() {
    setPending(true);
    setError(null);
    try {
      await deps.finish();
      navigate(step.next);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not finish setup.");
      setPending(false);
    }
  }

  return (
    <div>
      <ul className="divide-y divide-border/70 overflow-hidden rounded-lg bg-muted ring-1 ring-border/80">
        <DoneRow done>Signed in and named</DoneRow>
        <DoneRow done>Read how a task spec works</DoneRow>
        <DoneRow done={created !== null}>{created ? `API key "${created.name ?? "Coding agent"}" created` : "API key: create one in Settings"}</DoneRow>
        <DoneRow done>Coding agent command ready</DoneRow>
      </ul>
      <div className="mt-4 flex items-start gap-3 rounded-xl border border-border bg-card p-4">
        <TreeStructureIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
        <p className="text-[13.5px] text-muted-foreground">
          Push your spec, then ask your agent to label, train and gate it. Each task gets its evals, gates, training runs and traffic in the dashboard.
        </p>
      </div>
      {error && (
        <p role="alert" className="mt-4 text-[13px] text-negative">
          {error}
        </p>
      )}
      <StepFooter back={step.back} onBack={navigate}>
        <Button type="button" onClick={() => void enter()} disabled={pending} className={PRIMARY}>
          {pending ? (
            <Pending label="Opening your tasks" />
          ) : (
            <>
              Go to your tasks
              <ArrowRightIcon aria-hidden="true" />
            </>
          )}
        </Button>
      </StepFooter>
    </div>
  );
}

export function SkipSetup({ deps, navigate }: { deps: OnboardingDeps; navigate: (href: string) => void }) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      type="button"
      variant="link"
      disabled={pending}
      onClick={() => {
        setPending(true);
        void deps.finish().then(
          () => navigate(onboardingStep("done").next),
          () => setPending(false),
        );
      }}
      className="h-auto p-0 text-[13px] font-normal text-muted-foreground hover:text-foreground hover:no-underline"
    >
      Skip setup
    </Button>
  );
}
