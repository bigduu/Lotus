import { describe, expect, it } from "vitest";
import {
  buildPermissionDecisionSubmission,
  normalizePermissionRequest,
  preferredPermissionMatcherId,
  supportedPermissionDecisionIds,
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

  it("fails closed for missing request identity and unknown decision ids", () => {
    const missingIdentity = normalizePermissionRequest({
      permission_request: { allowed_decisions: ["allow_once"] },
    });
    expect(supportedPermissionDecisionIds(missingIdentity)).toEqual([]);

    const request = normalizePermissionRequest({
      permission_request: {
        request_id: "r2",
        allowed_decisions: [
          "allow_once",
          "allow_session",
          "allow_workspace",
          "allow_global",
          "future_action",
          "deny_once",
          "deny_session",
        ],
      },
    });
    expect(supportedPermissionDecisionIds(request)).toEqual([
      "allow_once",
      "allow_session",
      "allow_workspace",
      "allow_global",
      "deny_once",
      "deny_session",
    ]);
  });

  it("submits only an authorized decision and prefers the exact-resource matcher", () => {
    const request = normalizePermissionRequest({
      permission_request: {
        request_id: "r1",
        workspace_path: "/workspace",
        policy_revision: 7,
        allowed_decisions: ["allow_once", "allow_session", "allow_workspace"],
        suggested_matchers: [
          { id: "broad-matcher", kind: "path_subtree", value: "/workspace" },
          { id: "opaque-exact", kind: "exact_resource", value: "/workspace/file.txt" },
        ],
      },
    })!;
    expect(preferredPermissionMatcherId(request)).toBe("opaque-exact");
    expect(buildPermissionDecisionSubmission(request, "allow_workspace")).toEqual({
      request_id: "r1",
      decision: "allow_workspace",
      matcher_id: "opaque-exact",
      expected_policy_revision: 7,
    });
    expect(buildPermissionDecisionSubmission(request, "allow_session")).toEqual({
      request_id: "r1",
      decision: "allow_session",
      matcher_id: "opaque-exact",
    });
    expect(() => buildPermissionDecisionSubmission(request, "allow_global")).toThrow(
      "not authorized",
    );
  });

  it("requires explicit global confirmation and echoes only a suggested matcher id", () => {
    const request = normalizePermissionRequest({
      permission_request: {
        request_id: "r-global",
        policy_revision: "12",
        allowed_decisions: ["allow_global"],
        suggested_matchers: [
          { id: "exact_resource", kind: "exact_resource", value: "git status" },
          { id: "command_prefix", kind: "command_prefix", value: "git" },
        ],
      },
    })!;

    expect(() =>
      buildPermissionDecisionSubmission(request, "allow_global", {
        matcherId: "command_prefix",
      }),
    ).toThrow("explicit confirmation");
    expect(() =>
      buildPermissionDecisionSubmission(request, "allow_global", {
        matcherId: "invented",
        confirmGlobal: true,
      }),
    ).toThrow("not authorized");
    expect(
      buildPermissionDecisionSubmission(request, "allow_global", {
        matcherId: "command_prefix",
        confirmGlobal: true,
      }),
    ).toEqual({
      request_id: "r-global",
      decision: "allow_global",
      matcher_id: "command_prefix",
      expected_policy_revision: 12,
      confirm_global: true,
    });
  });

  it("requires a valid revision only for durable decisions", () => {
    const request = normalizePermissionRequest({
      permission_request: {
        request_id: "r-session",
        policy_revision: "not-a-revision",
        allowed_decisions: ["deny_session", "allow_workspace"],
        suggested_matchers: [
          { id: "exact_resource", kind: "exact_resource", value: "npm publish" },
        ],
      },
    })!;

    expect(buildPermissionDecisionSubmission(request, "deny_session")).toEqual({
      request_id: "r-session",
      decision: "deny_session",
      matcher_id: "exact_resource",
    });
    expect(() => buildPermissionDecisionSubmission(request, "allow_workspace")).toThrow(
      "policy revision",
    );
  });

  it("fails closed when a workspace decision has no stable workspace identity", () => {
    const request = normalizePermissionRequest({
      permission_request: {
        request_id: "r-workspace",
        policy_revision: 2,
        allowed_decisions: ["allow_workspace"],
        suggested_matchers: [
          { id: "exact_resource", kind: "exact_resource", value: "/tmp/file.txt" },
        ],
      },
    })!;

    expect(() => buildPermissionDecisionSubmission(request, "allow_workspace")).toThrow(
      "workspace identity",
    );
  });

  it("leaves legacy permission payloads to the legacy adapter", () => {
    expect(normalizePermissionRequest({ status: "awaiting_permission_approval" })).toBeNull();
  });
});
