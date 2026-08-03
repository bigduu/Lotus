export const SESSION_PERMISSION_MODES = ["default", "bypass", "auto"] as const;

export type SessionPermissionMode = (typeof SESSION_PERMISSION_MODES)[number];

export const isSessionPermissionMode = (value: unknown): value is SessionPermissionMode =>
  typeof value === "string" && SESSION_PERMISSION_MODES.includes(value as SessionPermissionMode);

export type SessionPermissionModeSnapshot = {
  mode: SessionPermissionMode;
  supportsTypedMode: boolean;
};

/**
 * Resolve Bamboo's server-authoritative session permission state.
 *
 * `permission_mode` is also the capability signal for Auto. Older backends only
 * expose `bypass_permissions`; that boolean means Bypass (never Auto), even
 * though new backends keep it true as a compatibility mirror for both modes.
 */
export const resolveSessionPermissionMode = (summary: {
  permission_mode?: unknown;
  bypass_permissions?: boolean;
}): SessionPermissionModeSnapshot => {
  const typedMode = summary.permission_mode;
  if (
    Object.prototype.hasOwnProperty.call(summary, "permission_mode") &&
    isSessionPermissionMode(typedMode)
  ) {
    return { mode: typedMode, supportsTypedMode: true };
  }

  return {
    mode: summary.bypass_permissions === true ? "bypass" : "default",
    supportsTypedMode: false,
  };
};
