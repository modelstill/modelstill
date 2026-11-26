import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { ProviderIcon, providerLabel, providerOf, type ProviderId } from "@modelstill/ui/blocks/provider-icon";

afterEach(cleanup);

describe("providerOf", () => {
  const cases: [string, ProviderId | null][] = [
    ["deepseek-chat", "deepseek"],
    ["deepseek/deepseek-v3", "deepseek"],
    ["qwen2.5-7b-instruct", "qwen"],
    ["Qwen/Qwen3-8B", "qwen"],
    ["gpt-4o-mini", "openai"],
    ["openai/gpt-5", "openai"],
    ["o3-mini", "openai"],
    ["claude-sonnet-4", "anthropic"],
    ["anthropic/claude-opus-4-1", "anthropic"],
    ["gemini-2.5-flash", "google"],
    ["gemma-3-4b", "google"],
    ["google/gemma-2-9b-it", "google"],
    ["mistral-small", "mistral"],
    ["mistralai/Mixtral-8x7B", "mistral"],
    ["llama-3.1-8b", "meta"],
    ["meta-llama/Llama-3.2-3B", "meta"],
    ["phi-4", "microsoft"],
    ["microsoft/Phi-3.5-mini-instruct", "microsoft"],
    ["nvidia/Nemotron-Mini-4B", "nvidia"],
    ["command-r-plus", "cohere"],
    ["grok-4", "xai"],
    ["granite-3.1-8b", "ibm"],
    ["kimi-k2", "moonshot"],
    ["glm-4.5", "zhipu"],
    ["my-own-model", null],
    ["", null],
  ];
  for (const [model, provider] of cases) {
    test(`${model || "empty"} is ${provider ?? "unknown"}`, () => {
      expect(providerOf(model)).toBe(provider);
    });
  }

  test("a provider name buried inside another word is not matched", () => {
    expect(providerOf("alphabet-soup")).toBeNull();
    expect(providerOf("metadata-tagger")).toBeNull();
  });
});

describe("providerLabel", () => {
  test("names the provider for people", () => {
    expect(providerLabel("deepseek")).toBe("DeepSeek");
    expect(providerLabel("openai")).toBe("OpenAI");
  });
});

describe("ProviderIcon", () => {
  test("draws the provider's logo, hidden from screen readers, with a title", () => {
    const { container } = render(<ProviderIcon model="deepseek-chat" size={20} />);
    const icon = container.querySelector("[data-slot='provider-icon']")!;
    expect(icon.getAttribute("data-provider")).toBe("deepseek");
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(icon.getAttribute("title")).toBe("DeepSeek");
    expect(icon.querySelector("svg")).toBeTruthy();
  });

  test("falls back to a neutral tile with the model's first letter", () => {
    const { container } = render(<ProviderIcon model="acme-tagger" />);
    const icon = container.querySelector("[data-slot='provider-icon']")!;
    expect(icon.getAttribute("data-provider")).toBe("unknown");
    expect(icon.textContent).toBe("A");
    expect(icon.getAttribute("title")).toBe("acme-tagger");
  });
});
