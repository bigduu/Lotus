import { describe, expect, it } from "vitest";

import { resolveSessionPermissionMode } from "./sessionPermissionMode";

describe("resolveSessionPermissionMode", () => {
  it.each(["default", "bypass", "auto"] as const)(
    "round-trips typed %s as a supported server mode",
    (permissionMode) => {
      expect(
        resolveSessionPermissionMode({
          permission_mode: permissionMode,
          bypass_permissions: permissionMode !== "default",
        }),
      ).toEqual({ mode: permissionMode, supportsTypedMode: true });
    },
  );

  it("never widens the legacy compatibility boolean to Auto", () => {
    expect(resolveSessionPermissionMode({ bypass_permissions: true })).toEqual({
      mode: "bypass",
      supportsTypedMode: false,
    });
  });

  it("fails safe when an advertised mode is malformed", () => {
    expect(
      resolveSessionPermissionMode({ permission_mode: "automatic", bypass_permissions: true }),
    ).toEqual({ mode: "bypass", supportsTypedMode: false });
  });
});
