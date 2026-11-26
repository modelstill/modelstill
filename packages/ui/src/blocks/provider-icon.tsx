import type { ComponentType, SVGProps } from "react";
import Anthropic from "@thesvg/react/anthropic";
import Cohere from "@thesvg/react/cohere";
import Deepseek from "@thesvg/react/deepseek";
import GoogleGemini from "@thesvg/react/google-gemini";
import Ibm from "@thesvg/react/ibm";
import Meta from "@thesvg/react/meta";
import Microsoft from "@thesvg/react/microsoft";
import Mistral from "@thesvg/react/mistral";
import Moonshot from "@thesvg/react/moonshot";
import Nvidia from "@thesvg/react/nvidia";
import Openai from "@thesvg/react/openai";
import Qwen from "@thesvg/react/qwen";
import Xai from "@thesvg/react/xai";
import Zhipu from "@thesvg/react/zhipu";
import { cn } from "@modelstill/ui/lib/utils";

export type ProviderId =
  | "deepseek"
  | "qwen"
  | "openai"
  | "anthropic"
  | "google"
  | "mistral"
  | "meta"
  | "microsoft"
  | "nvidia"
  | "cohere"
  | "xai"
  | "ibm"
  | "moonshot"
  | "zhipu";

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { variant?: string }>;

type Provider = { id: ProviderId; label: string; pattern: RegExp; icon: IconComponent; variant: string };

const WORD_START = "(?:^|[/:_\\-.\\s])";

function startsWith(...words: string[]): RegExp {
  return new RegExp(`${WORD_START}(?:${words.join("|")})`, "i");
}

const PROVIDERS: Provider[] = [
  { id: "deepseek", label: "DeepSeek", pattern: startsWith("deepseek"), icon: Deepseek as IconComponent, variant: "default" },
  { id: "qwen", label: "Qwen", pattern: startsWith("qwen", "qwq"), icon: Qwen as IconComponent, variant: "light" },
  { id: "openai", label: "OpenAI", pattern: startsWith("openai", "gpt", "o[134](?:-|$)", "chatgpt"), icon: Openai as IconComponent, variant: "default" },
  { id: "anthropic", label: "Anthropic", pattern: startsWith("anthropic", "claude"), icon: Anthropic as IconComponent, variant: "mono" },
  { id: "google", label: "Google", pattern: startsWith("google", "gemini", "gemma", "palm"), icon: GoogleGemini as IconComponent, variant: "default" },
  { id: "mistral", label: "Mistral AI", pattern: startsWith("mistral", "mixtral", "codestral", "ministral", "magistral", "devstral", "pixtral"), icon: Mistral as IconComponent, variant: "color" },
  { id: "meta", label: "Meta", pattern: startsWith("meta-llama", "meta/", "llama"), icon: Meta as IconComponent, variant: "mono" },
  { id: "microsoft", label: "Microsoft", pattern: startsWith("microsoft", "phi-?\\d"), icon: Microsoft as IconComponent, variant: "default" },
  { id: "nvidia", label: "NVIDIA", pattern: startsWith("nvidia", "nemotron"), icon: Nvidia as IconComponent, variant: "default" },
  { id: "cohere", label: "Cohere", pattern: startsWith("cohere", "command-", "aya"), icon: Cohere as IconComponent, variant: "default" },
  { id: "xai", label: "xAI", pattern: startsWith("xai", "x-ai", "grok"), icon: Xai as IconComponent, variant: "default" },
  { id: "ibm", label: "IBM", pattern: startsWith("ibm", "granite"), icon: Ibm as IconComponent, variant: "default" },
  { id: "moonshot", label: "Moonshot AI", pattern: startsWith("moonshot", "kimi"), icon: Moonshot as IconComponent, variant: "default" },
  { id: "zhipu", label: "Zhipu AI", pattern: startsWith("zhipu", "thudm", "zai-org", "glm-?\\d"), icon: Zhipu as IconComponent, variant: "color" },
];

const BY_ID = new Map(PROVIDERS.map((provider) => [provider.id, provider]));

export function providerOf(model: string): ProviderId | null {
  const name = model.trim();
  if (!name) return null;
  const org = name.includes("/") ? name.slice(0, name.indexOf("/")) : null;
  const byOrg = org ? PROVIDERS.find((provider) => provider.pattern.test(org)) : undefined;
  return (byOrg ?? PROVIDERS.find((provider) => provider.pattern.test(name)))?.id ?? null;
}

export function providerLabel(id: ProviderId): string {
  return BY_ID.get(id)!.label;
}

export function ProviderIcon({ model, size = 16, className }: { model: string; size?: number; className?: string }) {
  const id = providerOf(model);
  const provider = id ? BY_ID.get(id) : undefined;
  if (!provider) {
    return (
      <span
        aria-hidden="true"
        title={model}
        data-slot="provider-icon"
        data-provider="unknown"
        style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.6)) }}
        className={cn("inline-grid shrink-0 place-items-center rounded-[4px] bg-muted leading-none font-medium text-muted-foreground", className)}
      >
        {(model.trim().charAt(0) || "?").toUpperCase()}
      </span>
    );
  }
  const Icon = provider.icon;
  return (
    <span
      aria-hidden="true"
      title={provider.label}
      data-slot="provider-icon"
      data-provider={provider.id}
      style={{ width: size, height: size }}
      className={cn("inline-grid shrink-0 place-items-center text-foreground", className)}
    >
      <Icon variant={provider.variant} width={size} height={size} focusable="false" />
    </span>
  );
}
