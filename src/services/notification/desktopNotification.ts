/**
 * Desktop notification service for Tauri environment.
 *
 * Sends OS-level notifications via the Bodhi Rust backend. The decision of
 * *whether* to notify — category, priority, preference gating, and dedup — is
 * made server-side in `bamboo-notification` and delivered as a single
 * `notification` SSE event. The frontend only applies the local window-focus
 * check before showing the OS notification. Silently skips in browser mode.
 */
import { isTauriEnvironment } from "../../utils/environment";

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

export function isAppInBackground(): boolean {
  if (typeof document === "undefined") return false;
  return document.hidden;
}

/**
 * Show an OS desktop notification for a backend-delivered notification event.
 *
 * This is the *only* client-side gate: the backend has already classified the
 * event, applied user preferences, and deduplicated within its window, so we
 * just render it unless the main window is currently focused (presence check).
 */
export async function fireDesktopNotification(input: {
  title: string;
  body: string;
}): Promise<void> {
  if (!isTauriEnvironment()) {
    return;
  }

  const focused = await isMainWindowFocused();
  if (focused) {
    return;
  }

  try {
    await invokeShowNotification(input.title, input.body);
  } catch {
    // Silently skip if backend is unavailable
  }
}
