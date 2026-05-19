import { describe, expect, it } from "vitest";

import { sanitizeInstanceConfigForForm } from "./providerInstanceUtils";

describe("sanitizeInstanceConfigForForm", () => {
  it("removes reserved top-level instance keys from config payloads", () => {
    expect(
      sanitizeInstanceConfigForForm({
        type: "",
        provider_type: "copilot",
        label: "GitHub Copilot",
        enabled: true,
        id: "inst-1",
        api_key_encrypted: "secret",
        headless_auth: false,
        reasoning_effort: "medium",
        responses_only_models: ["gpt-5*"],
      }),
    ).toEqual({
      headless_auth: false,
      reasoning_effort: "medium",
      responses_only_models: ["gpt-5*"],
    });
  });

  it("preserves valid provider-specific config used to repopulate edit forms", () => {
    expect(
      sanitizeInstanceConfigForForm({
        headless_auth: false,
        reasoning_effort: "max",
        responses_only_models: ["gpt-5*"],
      }),
    ).toEqual({
      headless_auth: false,
      reasoning_effort: "max",
      responses_only_models: ["gpt-5*"],
    });
  });

  it("returns an empty object for nullish config", () => {
    expect(sanitizeInstanceConfigForForm(undefined)).toEqual({});
    expect(sanitizeInstanceConfigForForm(null)).toEqual({});
  });
});
