/**
 * Unified API Client
 *
 * Centralized HTTP client for all backend API communication.
 */

export { ApiClient, apiClient, agentApiClient } from "./client";
export type { ApiClientConfig } from "./client";

export {
  ApiError,
  isApiError,
  getErrorMessage,
  withFallback,
  isConfigRecoveryPendingError,
  CONFIG_RECOVERY_PENDING_CODE,
  isNoPendingQuestionError,
  NO_PENDING_QUESTION_ERROR,
} from "./errors";

export * from "./types";
