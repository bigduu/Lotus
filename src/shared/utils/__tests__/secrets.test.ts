import { describe, expect, it } from "vitest";
import { isMaskedSecret } from "../secrets";

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
