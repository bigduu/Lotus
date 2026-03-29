import { describe, expect, it } from "vitest";

import {
  formatCompletionPolicyViolationMessage,
  isCompletionPolicyViolationError,
} from "../completionPolicyViolation";

describe("completionPolicyViolation utils", () => {
  it("detects completion policy violation errors", () => {
    expect(
      isCompletionPolicyViolationError(
        "completion policy violation: model repeatedly attempted to end the task without calling conclusion_with_options while copilot conclusion-with-options enhancement is enabled (attempts=3)",
      ),
    ).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(isCompletionPolicyViolationError("network failed")).toBe(false);
  });

  it("formats a user-friendly message with raw detail", () => {
    const msg = formatCompletionPolicyViolationMessage("completion policy violation");
    expect(msg).toContain("Bamboo stopped this completion");
    expect(msg).toContain("instead of calling conclusion_with_options");
    expect(msg).toContain("Raw error");
  });
});
