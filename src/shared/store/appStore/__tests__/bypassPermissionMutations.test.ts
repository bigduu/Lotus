import { beforeEach, describe, expect, it } from "vitest";

import {
  beginBypassPermissionMutation,
  beginBypassPermissionSummaryRequest,
  confirmBypassPermissionMutation,
  failBypassPermissionMutation,
  reconcileBypassPermissionSummary,
  resetBypassPermissionMutations,
} from "../bypassPermissionMutations";

describe("bypass permission mutation revisions", () => {
  beforeEach(resetBypassPermissionMutations);

  it("uses server truth outside an in-flight PATCH", () => {
    expect(reconcileBypassPermissionSummary("s1", false)).toBe(false);
    expect(reconcileBypassPermissionSummary("s1", true)).toBe(true);
  });

  it("preserves the optimistic value only in flight and rolls back to the latest confirmed value", () => {
    const revision = beginBypassPermissionMutation("s1", true, false);
    expect(reconcileBypassPermissionSummary("s1", false)).toBe(true);
    expect(failBypassPermissionMutation("s1", revision)).toBe(false);
    expect(reconcileBypassPermissionSummary("s1", false)).toBe(false);
  });

  it("ignores stale completions from an older mutation revision", () => {
    const stale = beginBypassPermissionMutation("s1", true, false);
    const current = beginBypassPermissionMutation("s1", false, true);

    expect(confirmBypassPermissionMutation("s1", stale)).toBe(false);
    expect(failBypassPermissionMutation("s1", stale)).toBeNull();
    expect(reconcileBypassPermissionSummary("s1", true)).toBe(false);
    expect(confirmBypassPermissionMutation("s1", current)).toBe(true);
  });

  it("fences a pre-PATCH summary response that arrives after PATCH success", () => {
    const staleSummary = beginBypassPermissionSummaryRequest();
    const revision = beginBypassPermissionMutation("s1", true, false);
    expect(confirmBypassPermissionMutation("s1", revision)).toBe(true);

    expect(reconcileBypassPermissionSummary("s1", false, staleSummary)).toBe(true);

    const authoritativeSummary = beginBypassPermissionSummaryRequest();
    expect(reconcileBypassPermissionSummary("s1", true, authoritativeSummary)).toBe(true);
    expect(reconcileBypassPermissionSummary("s1", false)).toBe(false);
  });

  it("fences a summary started while the PATCH was still in flight", () => {
    const revision = beginBypassPermissionMutation("s1", true, false);
    const racingSummary = beginBypassPermissionSummaryRequest();
    expect(confirmBypassPermissionMutation("s1", revision)).toBe(true);

    expect(reconcileBypassPermissionSummary("s1", false, racingSummary)).toBe(true);
  });
});
