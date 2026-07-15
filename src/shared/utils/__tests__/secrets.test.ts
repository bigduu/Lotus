import { describe, expect, it } from "vitest";
import { isMaskedSecret, redactSensitive } from "../secrets";

describe("isMaskedSecret", () => {
  it("recognizes the redaction placeholder", () => {
    expect(isMaskedSecret("****...****")).toBe(true);
    expect(isMaskedSecret("********")).toBe(true);
    expect(isMaskedSecret("  ****...****  ")).toBe(true);
  });

  it("rejects empty / whitespace-only values", () => {
    expect(isMaskedSecret("")).toBe(false);
    expect(isMaskedSecret("   ")).toBe(false);
    expect(isMaskedSecret(undefined)).toBe(false);
    expect(isMaskedSecret(null)).toBe(false);
  });

  it("rejects a real secret even if it contains mask-like characters", () => {
    expect(isMaskedSecret("sk-live-abc")).toBe(false);
    expect(isMaskedSecret("id.secret...suffix")).toBe(false);
  });

  it("rejects a real value concatenated with the mask (substring, not exact match)", () => {
    expect(isMaskedSecret("****...****sk-newkey123")).toBe(false);
    expect(isMaskedSecret("sk-newkey123****...****")).toBe(false);
  });
});

describe("redactSensitive", () => {
  it("redacts nested api_key values without mutating the input", () => {
    const config = {
      provider: "openai",
      providers: {
        openai: { api_key: "sk-live-abc123", model: "gpt-5" },
        anthropic: { api_key: "sk-ant-secret", model: "claude" },
      },
    };
    const redacted = redactSensitive(config);
    expect(redacted.providers.openai.api_key).toBe("***redacted***");
    expect(redacted.providers.anthropic.api_key).toBe("***redacted***");
    expect(redacted.providers.openai.model).toBe("gpt-5");
    // original object is untouched
    expect(config.providers.openai.api_key).toBe("sk-live-abc123");
  });

  it("redacts other credential-shaped keys: token, secret, password, api_key_encrypted", () => {
    const payload = {
      token: "ntfy-token-xyz",
      device_key: "bark-device-key",
      secret: "shh",
      password: "hunter2",
      api_key_encrypted: "encrypted-blob",
      label: "my instance",
    };
    const redacted = redactSensitive(payload);
    expect(redacted.token).toBe("***redacted***");
    expect(redacted.secret).toBe("***redacted***");
    expect(redacted.password).toBe("***redacted***");
    expect(redacted.api_key_encrypted).toBe("***redacted***");
    expect(redacted.label).toBe("my instance");
  });

  it("leaves empty/undefined sensitive fields as-is instead of masking absence", () => {
    const config = { api_key: undefined, token: "" };
    const redacted = redactSensitive(config);
    expect(redacted.api_key).toBeUndefined();
    expect(redacted.token).toBe("");
  });

  it("redacts through arrays and preserves non-sensitive structure", () => {
    const config = {
      providers: [
        { name: "openai", api_key: "sk-1" },
        { name: "anthropic", api_key: "sk-2" },
      ],
    };
    const redacted = redactSensitive(config);
    expect(redacted.providers[0].api_key).toBe("***redacted***");
    expect(redacted.providers[1].api_key).toBe("***redacted***");
    expect(redacted.providers[0].name).toBe("openai");
  });

  it("passes through primitives and null unchanged", () => {
    expect(redactSensitive(null)).toBeNull();
    expect(redactSensitive(42)).toBe(42);
    expect(redactSensitive("plain string")).toBe("plain string");
  });
});
