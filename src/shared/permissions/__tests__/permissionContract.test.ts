import { describe, expect, it } from "vitest";
import {
  buildPermissionDecisionSubmission,
  normalizePermissionRequest,
  phaseOnePermissionDecisionIds,
} from "../permissionContract";

describe("normalizePermissionRequest", () => {
  it("normalizes canonical typed decisions without dropping unknown ids", () => {
    expect(
      normalizePermissionRequest({
        permission_request: {
          request_id: "r1",
          reason_code: "always_ask",
          effective_mode: "ask",
          allowed_decisions: [
            { id: "allow_once", scope: "once" },
            { action: "future_backend_action", label: "Backend label" },
          ],
          suggested_matchers: [{ id: "m1", kind: "command_prefix", value: "git push" }],
        },
      }),
    ).toMatchObject({
      requestId: "r1",
      reasonCode: "always_ask",
      effectiveMode: "ask",
      suggestedMatchers: [{ id: "m1", kind: "command_prefix", value: "git push" }],
      allowedDecisions: [{ id: "allow_once", scope: "once" }, { id: "future_backend_action" }],
    });
  });

  it("fails closed for missing request identity and unshipped decision ids", () => {
    const missingIdentity = normalizePermissionRequest({
      permission_request: { allowed_decisions: ["allow_once"] },
    });
    expect(phaseOnePermissionDecisionIds(missingIdentity)).toEqual([]);

    const request = normalizePermissionRequest({
      permission_request: {
        request_id: "r2",
        allowed_decisions: ["allow_once", "allow_workspace", "future_action", "deny_once"],
      },
    });
    expect(phaseOnePermissionDecisionIds(request)).toEqual(["allow_once", "deny_once"]);
  });

  it("submits only an authorized decision and opaque matcher id", () => {
    const request = normalizePermissionRequest({
      permission_request: {
        request_id: "r1",
        policy_revision: 7,
        allowed_decisions: ["allow_once", "allow_workspace"],
        suggested_matchers: [{ id: "opaque-m1", kind: "path_subtree", value: "/workspace" }],
      },
    })!;
    expect(buildPermissionDecisionSubmission(request, "allow_workspace")).toEqual({
      request_id: "r1",
      decision: "allow_workspace",
      matcher_id: "opaque-m1",
      expected_policy_revision: 7,
    });
    expect(() => buildPermissionDecisionSubmission(request, "allow_global")).toThrow(
      "not authorized",
    );
  });

  it("leaves legacy permission payloads to the legacy adapter", () => {
    expect(normalizePermissionRequest({ status: "awaiting_permission_approval" })).toBeNull();
  });
});
