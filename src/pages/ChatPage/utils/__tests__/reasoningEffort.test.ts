import { describe, it, expect } from "vitest";
import {
  getReasoningEffortForProvider,
  resolveProviderDefaultReasoningEffort,
} from "../reasoningEffort";
import type { ProviderConfig, ProviderInstance } from "../../types/providerConfig";

const instance = (
  id: string,
  type: ProviderInstance["type"],
  reasoning_effort?: string,
): ProviderInstance => ({
  id,
  type,
  label: id,
  enabled: true,
  config: reasoning_effort ? { reasoning_effort } : {},
});

describe("reasoningEffort resolver", () => {
  it("resolves legacy provider-type keys from the providers map", () => {
    const config: ProviderConfig = {
      provider: "openai",
      providers: { openai: { api_key: "x", reasoning_effort: "low" } },
    };
    expect(getReasoningEffortForProvider(config, "openai")).toBe("low");
  });

  it("resolves a bodhi provider (previously missed)", () => {
    const config: ProviderConfig = {
      provider: "bodhi",
      providers: { bodhi: { reasoning_effort: "xhigh" } },
    };
    expect(getReasoningEffortForProvider(config, "bodhi")).toBe("xhigh");
  });

  it("resolves an instance id from the authoritative providerInstances array", () => {
    // Legacy load path: providers map is keyed by ProviderType, NOT instance id.
    const config: ProviderConfig = {
      provider: "copilot-work",
      providers: { copilot: {} },
    };
    const instances = [instance("copilot-work", "copilot", "high")];
    expect(getReasoningEffortForProvider(config, "copilot-work", instances)).toBe("high");
  });

  it("resolves an instance id when providers map is keyed by id (instance load path)", () => {
    const config: ProviderConfig = {
      provider: "copilot-work",
      providers: { "copilot-work": { reasoning_effort: "max" } } as ProviderConfig["providers"],
    };
    expect(getReasoningEffortForProvider(config, "copilot-work")).toBe("max");
  });

  it("falls back to the instance's provider-type entry when its own config has none", () => {
    const config: ProviderConfig = {
      provider: "copilot-work",
      providers: { copilot: { reasoning_effort: "medium" } },
    };
    const instances = [instance("copilot-work", "copilot")];
    expect(getReasoningEffortForProvider(config, "copilot-work", instances)).toBe("medium");
  });

  it("returns undefined for unknown/empty keys (no silent default)", () => {
    const config: ProviderConfig = { provider: "openai", providers: {} };
    expect(getReasoningEffortForProvider(config, "nope")).toBeUndefined();
    expect(getReasoningEffortForProvider(config, "   ")).toBeUndefined();
    expect(getReasoningEffortForProvider(config, null)).toBeUndefined();
  });

  it("prefers the model_ref provider over fallbacks", () => {
    const config: ProviderConfig = {
      provider: "openai",
      providers: { openai: { api_key: "x", reasoning_effort: "low" } },
      defaults: { chat: { provider: "openai", model: "gpt-4o" } },
    };
    const instances = [instance("anthropic-work", "anthropic", "high")];
    const ref = { provider: "anthropic-work", model: "claude" };
    expect(resolveProviderDefaultReasoningEffort(config, ref, "openai", instances)).toBe("high");
  });
});
