/**
 * Pure helpers for the SSE subscription runner (agentSubscriptionRunner).
 *
 * These have no closure over per-subscription state, so they live here to keep
 * the runner focused on the engine wiring.
 */

export const PARENT_SETTLE_DELAY_MS = 250;
export const TITLE_REFRESH_RETRY_DELAYS_MS = [1200, 3000] as const;
