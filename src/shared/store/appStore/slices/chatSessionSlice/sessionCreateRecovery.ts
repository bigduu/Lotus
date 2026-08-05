import type { SessionCreateOperationStatus } from "@services/chat/AgentService";

/**
 * UI-facing continuation for one ambiguous logical create action. Calling
 * `retry` reuses the original idempotency key and runs the normal store insert
 * path, so a recovered session is selected exactly once.
 */
export class ChatSessionCreateRecoveryError extends Error {
  readonly recoverable = true;

  constructor(
    public readonly idempotencyKey: string,
    public readonly operationStatus: Extract<SessionCreateOperationStatus, "pending" | "unknown">,
    public readonly retry: () => Promise<string>,
    message: string,
  ) {
    super(message);
    this.name = "ChatSessionCreateRecoveryError";
  }
}

export function isChatSessionCreateRecoveryError(
  error: unknown,
): error is ChatSessionCreateRecoveryError {
  return error instanceof ChatSessionCreateRecoveryError;
}
