/**
 * API Error Handling
 *
 * Provides standardized error handling for API requests.
 */

import { ApiError } from "./client";

export { ApiError } from "./client";

/**
 * Check if error is an API error
 */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** `error.code` value the bamboo backend returns for a 409 on any settings
 *  write while a config-corruption recovery is pending confirmation
 *  (`AppError::ConfigRecoveryPending`, bamboo #153 / PR #493). */
export const CONFIG_RECOVERY_PENDING_CODE = "config_recovery_pending";

/**
 * Whether `error` is the 409 a settings save gets back while a pending
 * config-corruption recovery is unconfirmed. Mirrors the `error.code` parsing
 * pattern used for `proxy_auth_required` in `ModelService`.
 */
export function isConfigRecoveryPendingError(error: unknown): boolean {
  if (!isApiError(error) || error.status !== 409 || !error.body) {
    return false;
  }
  try {
    const parsed = JSON.parse(error.body) as { error?: { code?: string } };
    return parsed.error?.code === CONFIG_RECOVERY_PENDING_CODE;
  } catch {
    return false;
  }
}

/**
 * Get user-friendly error message from API error
 */
export function getErrorMessage(error: unknown): string {
  if (isConfigRecoveryPendingError(error)) {
    return "Settings can't be saved until the pending config recovery is resolved. Open Settings and use the config recovery banner to Accept or Reject it.";
  }

  if (isApiError(error)) {
    if (error.status === 401) {
      return "Authentication failed. Please check your credentials.";
    }
    if (error.status === 403) {
      return "You don't have permission to perform this action.";
    }
    if (error.status === 404) {
      return "The requested resource was not found.";
    }
    if (error.status >= 500) {
      // Keep HTTP semantics (500) but still surface the server-provided message when available.
      // Our ApiClient extracts it from JSON bodies like:
      // - { error: { message: "..." } }
      // - { success: false, error: "..." }
      return error.message?.trim() ? error.message : "Server error. Please try again later.";
    }
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "An unexpected error occurred";
}

/**
 * Handle API error with fallback value
 */
export async function withFallback<T>(
  promise: Promise<T>,
  fallback: T,
  onError?: (error: ApiError) => void,
): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (isApiError(error) && onError) {
      onError(error);
    }
    return fallback;
  }
}
