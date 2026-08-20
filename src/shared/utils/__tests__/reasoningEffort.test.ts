import { describe, it, expect } from "vitest";
import {
  DEFAULT_REASONING_EFFORT,
  getReasoningEffortForProvider,
  resolveEffectiveReasoningEffort,
  resolveProviderDefaultReasoningEffort,
} from "../reasoningEffort";
import type { ProviderConfig, ProviderInstance } from "@shared/types/providerConfig";

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
  it("resolves synthesized provider-type instance ids from the normalized map", () => {
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
    const config: ProviderConfig = {
      provider: "copilot-work",
      providers: { copilot: {} },
    };
    const instances = [instance("copilot-work", "copilot", "high")];
    expect(getReasoningEffortForProvider(config, "copilot-work", instances)).toBe("high");
  });

  it("resolves an instance id when the normalized providers map is keyed by id", () => {
    const config: ProviderConfig = {
      provider: "copilot-work",
      providers: { "copilot-work": { reasoning_effort: "max" } } as ProviderConfig["providers"],
    };
    expect(getReasoningEffortForProvider(config, "copilot-work")).toBe("max");
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

describe("resolveEffectiveReasoningEffort", () => {
  it("prefers session, then input, then persisted, then provider default", () => {
    expect(
      resolveEffectiveReasoningEffort({
        sessionEffort: "max",
        inputEffort: "high",
        persistedEffort: "low",
        providerDefault: "xhigh",
      }),
    ).toBe("max");
    expect(
      resolveEffectiveReasoningEffort({
        inputEffort: "high",
        persistedEffort: "low",
        providerDefault: "xhigh",
      }),
    ).toBe("high");
    expect(
      resolveEffectiveReasoningEffort({ persistedEffort: "low", providerDefault: "xhigh" }),
    ).toBe("low");
    expect(resolveEffectiveReasoningEffort({ providerDefault: "xhigh" })).toBe("xhigh");
  });

  it("treats null and undefined sources as absent (falls through)", () => {
    expect(
      resolveEffectiveReasoningEffort({
        sessionEffort: null,
        inputEffort: undefined,
        persistedEffort: null,
        providerDefault: "max",
      }),
    ).toBe("max");
  });

  it("falls back to the single DEFAULT_REASONING_EFFORT when nothing is set", () => {
    expect(resolveEffectiveReasoningEffort({})).toBe(DEFAULT_REASONING_EFFORT);
    expect(DEFAULT_REASONING_EFFORT).toBe("medium");
  });
});
