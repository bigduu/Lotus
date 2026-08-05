/**
 * Generate a key for one logical session-create action.
 *
 * Callers that must survive a page reload can allocate and persist this key
 * before issuing the first POST, then pass it back to AgentClient.
 */
export function createSessionIdempotencyKey(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) {
    return `lotus-session-${randomUuid}`;
  }

  // Older embedded WebViews may not expose randomUUID. Two random segments
  // plus a timestamp still keep independent explicit actions distinct.
  return `lotus-session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
