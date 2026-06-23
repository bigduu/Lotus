type DebugFlagKey = "bodhi_debug_ui_layout" | "bodhi_debug_verbose";

const isDevRuntime = (): boolean => Boolean(import.meta.env.DEV) && import.meta.env.MODE !== "test";

const readFlag = (key: DebugFlagKey): boolean => {
  if (!isDevRuntime()) return false;
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
};

export const isUILayoutDebugEnabled = (): boolean => readFlag("bodhi_debug_ui_layout");

export const uiLayoutDebug = (message: string, data?: Record<string, unknown>): void => {
  if (!isUILayoutDebugEnabled()) return;
  // eslint-disable-next-line no-console -- dev-only debug trace
  console.log(`[ui-layout] ${message}`, data ?? "");
};

/**
 * General-purpose dev-only debug logger.
 *
 * Usage: `debugLog("[Agent]", "Subscribing to events", { sessionId })`
 *
 * In production builds all calls are no-ops (zero cost).
 * In dev builds, set `localStorage.bodhi_debug_verbose = "1"` to enable.
 */
export const debugLog = (tag: string, message: string, ...args: unknown[]): void => {
  if (!isDevRuntime()) return;
  if (!readFlag("bodhi_debug_verbose")) return;
  // eslint-disable-next-line no-console -- dev-only debug trace
  console.log(`${tag} ${message}`, ...args);
};

/** localStorage key for the opt-in v2 WebSocket transport feature flag. */
const API_V2_WS_FLAG_KEY = "bodhi_api_v2_ws";

/**
 * Opt-in feature flag: route the account feed + per-session agent event streams
 * over the unified `/v2/stream` WebSocket instead of the two legacy SSE
 * connections.
 *
 * Default OFF (zero behavior change). Unlike the dev-only debug flags above this
 * is honored in any build so the WS transport can be exercised against a running
 * backend, but it must be explicitly enabled.
 *
 * Enable: `localStorage.setItem("bodhi_api_v2_ws", "1")` then reload.
 * Disable: `localStorage.removeItem("bodhi_api_v2_ws")` (or set to anything but
 * "1") then reload.
 */
export const isApiV2WsEnabled = (): boolean => {
  try {
    return localStorage.getItem(API_V2_WS_FLAG_KEY) === "1";
  } catch {
    return false;
  }
};
