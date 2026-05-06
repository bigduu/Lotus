/**
 * Desktop notification service for Tauri environment.
 *
 * Sends OS-level notifications via Bodhi Rust backend when the app is in
 * the background and user action is required. Silently skips when running
 * in browser mode.
 */
import { isTauriEnvironment } from "../../utils/environment";

export interface DesktopNotificationOptions {
  /** Notification title */
  title: string;
  /** Notification body text */
  body: string;
  /** Session identifier for deduplication */
  sessionId?: string;
  /** Event type for deduplication */
  eventType: string;
  /** Optional unique identifier within the event type (e.g. toolCallId) */
  eventId?: string;
}

// ── Preferences ────────────────────────────────────────────────────────

const NOTIFICATION_PREFS_KEY = "bodhi_notification_prefs";

export interface NotificationPreferences {
  /** Master switch for all desktop notifications */
  enabled: boolean;
  /** Notify when agent needs clarification */
  onClarification: boolean;
  /** Notify when a mutating tool needs approval */
  onToolApproval: boolean;
  /** Notify on critical context pressure */
  onContextPressure: boolean;
  /** Notify when a background sub-agent completes */
  onSubAgentComplete: boolean;
}

const DEFAULT_PREFS: NotificationPreferences = {
  enabled: true,
  onClarification: true,
  onToolApproval: true,
  onContextPressure: true,
  onSubAgentComplete: false,
};

export function getNotificationPreferences(): NotificationPreferences {
  if (typeof localStorage === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(NOTIFICATION_PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<NotificationPreferences>;
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function setNotificationPreferences(prefs: Partial<NotificationPreferences>): void {
  if (typeof localStorage === "undefined") return;
  const current = getNotificationPreferences();
  const next = { ...current, ...prefs };
  localStorage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify(next));
}

function isNotificationEnabledForEventType(eventType: string): boolean {
  const prefs = getNotificationPreferences();
  if (!prefs.enabled) return false;

  switch (eventType) {
    case "clarification":
      return prefs.onClarification;
    case "tool_approval":
      return prefs.onToolApproval;
    case "context_pressure":
      return prefs.onContextPressure;
    case "subagent_completed":
      return prefs.onSubAgentComplete;
    default:
      return true;
  }
}

// ── Dedup ──────────────────────────────────────────────────────────────

const sentNotifications = new Set<string>();
const NOTIFICATION_DEDUP_WINDOW_MS = 30_000;

export function buildDedupKey(options: DesktopNotificationOptions): string {
  const parts = [options.sessionId ?? "global", options.eventType];
  if (options.eventId) {
    parts.push(options.eventId);
  }
  return parts.join("::");
}

function scheduleDedupCleanup(key: string): void {
  setTimeout(() => {
    sentNotifications.delete(key);
  }, NOTIFICATION_DEDUP_WINDOW_MS);
}

// ── Public API ─────────────────────────────────────────────────────────

export function isAppInBackground(): boolean {
  if (typeof document === "undefined") return false;
  return document.hidden;
}

/**
 * Check if the Tauri main window is focused via Rust backend.
 * Returns true if focused (or if check fails), false if not focused.
 */
async function isMainWindowFocused(): Promise<boolean> {
  const tauriInternals = (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ as
    | { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
    | undefined;
  const invoke = tauriInternals?.invoke;
  if (typeof invoke !== "function") {
    return true; // fallback: assume focused if we can't check
  }

  try {
    const focused = await invoke("is_main_window_focused");
    return focused === true;
  } catch {
    return true; // fallback on error
  }
}

/**
 * Invoke the Bodhi Rust backend to show a native desktop notification.
 */
async function invokeShowNotification(title: string, body: string): Promise<void> {
  const tauriInternals = (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ as
    | { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
    | undefined;
  const invoke = tauriInternals?.invoke;
  if (typeof invoke !== "function") {
    throw new Error("Tauri invoke not available");
  }

  await invoke("show_desktop_notification", { title, body });
}

/**
 * Manually trigger a test notification. Use this to verify notifications are working.
 */
export async function sendTestNotification(
  title = "Test Notification",
  body = "Bodhi notifications are working!",
): Promise<void> {
  if (!isTauriEnvironment()) {
    return;
  }

  try {
    await invokeShowNotification(title, body);
  } catch {
    // Silently skip if backend is unavailable
  }
}

export async function sendDesktopNotification(options: DesktopNotificationOptions): Promise<void> {
  if (!isTauriEnvironment()) {
    return;
  }

  const focused = await isMainWindowFocused();
  if (focused) {
    return;
  }

  if (!isNotificationEnabledForEventType(options.eventType)) {
    return;
  }

  const dedupKey = buildDedupKey(options);
  if (sentNotifications.has(dedupKey)) {
    return;
  }

  try {
    await invokeShowNotification(options.title, options.body);

    sentNotifications.add(dedupKey);
    scheduleDedupCleanup(dedupKey);
  } catch {
    // Silently skip if backend is unavailable
  }
}

export function clearNotificationDedupCache(): void {
  sentNotifications.clear();
}
