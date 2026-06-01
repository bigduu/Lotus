/**
 * Pure helpers for the SSE subscription runner (agentSubscriptionRunner).
 *
 * These have no closure over per-subscription state, so they live here to keep
 * the runner focused on the engine wiring.
 */

export const PARENT_SETTLE_DELAY_MS = 250;
export const TITLE_REFRESH_RETRY_DELAYS_MS = [1200, 3000] as const;

export const DEFAULT_SESSION_TITLES = new Set([
  "New Session",
  "新建会话",
  "新建會話",
  "Nouvelle session",
  "新しいセッション",
  "नया सत्र",
]);

/**
 * Returns true when a chat title is effectively "untitled" — either empty, a
 * known default title, or a generated "New Session - …"/"New session with …"
 * prefix that has not yet been replaced by a backend-generated title.
 */
export const isUntitledChatTitle = (title: string | undefined | null): boolean => {
  const normalized = (title || "").trim();
  if (!normalized) return true;
  if (DEFAULT_SESSION_TITLES.has(normalized)) return true;
  const prefixed =
    normalized.startsWith("New Session - ") ||
    normalized.startsWith("New Session with ") ||
    normalized.startsWith("New session - ") ||
    normalized.startsWith("New session with ");
  if (!prefixed) return false;
  const suffix = normalized
    .replace(/^New Session - /, "")
    .replace(/^New Session with /, "")
    .replace(/^New session - /, "")
    .replace(/^New session with /, "")
    .trim();
  return suffix.length > 0;
};
