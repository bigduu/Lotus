import { describe, expect, it, vi } from "vitest";

import {
  ApiError,
  getErrorMessage,
  isConfigRecoveryPendingError,
  isNoPendingQuestionError,
  NO_PENDING_QUESTION_ERROR,
  withFallback,
} from "./errors";

/** Mirrors the bamboo `ResponseError` envelope for `AppError::ConfigRecoveryPending`
 *  (bamboo #153 / PR #493): 409 + `error.code === "config_recovery_pending"`. */
function configRecoveryPendingError(message = "config recovery pending"): ApiError {
  const body = JSON.stringify({
    error: { type: "api_error", message, code: "config_recovery_pending" },
  });
  return new ApiError(message, 409, "Conflict", body);
}

describe("getErrorMessage", () => {
  it("surfaces server-provided message for 500 errors", () => {
    const err = new ApiError("Failed to reload provider: boom", 500, "Internal Server Error");
    expect(getErrorMessage(err)).toBe("Failed to reload provider: boom");
  });

  it("surfaces a config-recovery-pending-specific message instead of the raw 409", () => {
    const err = configRecoveryPendingError("config.json is awaiting confirmation");
    expect(getErrorMessage(err)).toContain("config recovery");
    expect(getErrorMessage(err)).not.toBe("config.json is awaiting confirmation");
  });

  it("does not misclassify an unrelated 409 as config-recovery-pending", () => {
    const body = JSON.stringify({
      error: { type: "api_error", message: "conflict", code: "other" },
    });
    const err = new ApiError("conflict", 409, "Conflict", body);
    expect(getErrorMessage(err)).toBe("conflict");
  });

  it("keeps friendly messages for common client errors", () => {
    const err = new ApiError("Not Found", 404, "Not Found");
    expect(getErrorMessage(err)).toBe("The requested resource was not found.");
  });

  it("handles 401 Unauthorized errors", () => {
    const err = new ApiError("Unauthorized", 401, "Unauthorized");
    expect(getErrorMessage(err)).toBe("Authentication failed. Please check your credentials.");
  });

  it("handles 403 Forbidden errors", () => {
    const err = new ApiError("Forbidden", 403, "Forbidden");
    expect(getErrorMessage(err)).toBe("You don't have permission to perform this action.");
  });

  it("handles 429 Too Many Requests errors", () => {
    const err = new ApiError("Too Many Requests", 429, "Too Many Requests");
    expect(getErrorMessage(err)).toBe("Too Many Requests");
  });

  it("handles unknown status codes", () => {
    const err = new ApiError("Custom error", 418, "I'm a teapot");
    expect(getErrorMessage(err)).toBe("Custom error");
  });

  it("handles 400 Bad Request errors", () => {
    const err = new ApiError("Bad Request", 400, "Bad Request");
    expect(getErrorMessage(err)).toBe("Bad Request");
  });
});

describe("isConfigRecoveryPendingError", () => {
  it("recognizes the 409 config_recovery_pending envelope", () => {
    expect(isConfigRecoveryPendingError(configRecoveryPendingError())).toBe(true);
  });

  it("rejects a 409 with a different error code", () => {
    const body = JSON.stringify({ error: { type: "api_error", message: "x", code: "other" } });
    expect(isConfigRecoveryPendingError(new ApiError("x", 409, "Conflict", body))).toBe(false);
  });

  it("rejects a non-409 status even with a matching code", () => {
    const body = JSON.stringify({
      error: { type: "api_error", message: "x", code: "config_recovery_pending" },
    });
    expect(
      isConfigRecoveryPendingError(new ApiError("x", 500, "Internal Server Error", body)),
    ).toBe(false);
  });

  it("rejects a non-JSON body without throwing", () => {
    expect(isConfigRecoveryPendingError(new ApiError("x", 409, "Conflict", "not json"))).toBe(
      false,
    );
  });

  it("rejects non-ApiError values", () => {
    expect(isConfigRecoveryPendingError(new Error("boom"))).toBe(false);
    expect(isConfigRecoveryPendingError(undefined)).toBe(false);
  });
});

describe("isNoPendingQuestionError", () => {
  it("recognizes the exact Bamboo 400 response", () => {
    const body = JSON.stringify({
      error: { message: NO_PENDING_QUESTION_ERROR, type: "api_error" },
    });
    expect(
      isNoPendingQuestionError(new ApiError(NO_PENDING_QUESTION_ERROR, 400, "Bad Request", body)),
    ).toBe(true);
  });

  it("supports the legacy flat error envelope", () => {
    const body = JSON.stringify({ error: NO_PENDING_QUESTION_ERROR });
    expect(
      isNoPendingQuestionError(new ApiError(NO_PENDING_QUESTION_ERROR, 400, "Bad Request", body)),
    ).toBe(true);
  });

  it("keeps Invalid response failures visible", () => {
    const body = JSON.stringify({
      error: { message: "Invalid response", type: "api_error" },
      message: "Choose a valid option",
    });
    expect(
      isNoPendingQuestionError(new ApiError("Invalid response", 400, "Bad Request", body)),
    ).toBe(false);
  });

  it("requires the matching status and structured body", () => {
    const body = JSON.stringify({
      error: { message: NO_PENDING_QUESTION_ERROR, type: "api_error" },
    });
    expect(
      isNoPendingQuestionError(new ApiError(NO_PENDING_QUESTION_ERROR, 404, "Not Found", body)),
    ).toBe(false);
    expect(
      isNoPendingQuestionError(
        new ApiError(NO_PENDING_QUESTION_ERROR, 500, "Internal Server Error", body),
      ),
    ).toBe(false);
    expect(
      isNoPendingQuestionError(new ApiError(NO_PENDING_QUESTION_ERROR, 400, "Bad Request")),
    ).toBe(false);
    expect(
      isNoPendingQuestionError(
        new ApiError(NO_PENDING_QUESTION_ERROR, 400, "Bad Request", "not json"),
      ),
    ).toBe(false);
    expect(isNoPendingQuestionError(new Error(NO_PENDING_QUESTION_ERROR))).toBe(false);
  });
});

describe("withFallback", () => {
  it("returns value when promise resolves", async () => {
    const result = await withFallback(Promise.resolve("success"), "fallback value");
    expect(result).toBe("success");
  });

  it("returns fallback when promise rejects with non-ApiError", async () => {
    const result = await withFallback(Promise.reject(new Error("Network error")), "fallback value");
    expect(result).toBe("fallback value");
  });

  it("returns fallback when promise rejects with ApiError", async () => {
    const apiError = new ApiError("Server error", 500, "Internal Server Error");
    const result = await withFallback(Promise.reject(apiError), "fallback value");
    expect(result).toBe("fallback value");
  });

  it("calls onError when ApiError occurs", async () => {
    const onError = vi.fn();
    const apiError = new ApiError("Not found", 404, "Not Found");

    await withFallback(Promise.reject(apiError), "fallback value", onError);

    expect(onError).toHaveBeenCalledWith(apiError);
  });

  it("does not call onError for non-ApiError", async () => {
    const onError = vi.fn();

    await withFallback(Promise.reject(new Error("Network error")), "fallback value", onError);

    expect(onError).not.toHaveBeenCalled();
  });

  it("does not call onError when promise resolves", async () => {
    const onError = vi.fn();

    await withFallback(Promise.resolve("success"), "fallback value", onError);

    expect(onError).not.toHaveBeenCalled();
  });

  it("handles null fallback value", async () => {
    const result = await withFallback(Promise.reject(new Error("error")), null);
    expect(result).toBeNull();
  });

  it("handles undefined fallback value", async () => {
    const result = await withFallback(Promise.reject(new Error("error")), undefined);
    expect(result).toBeUndefined();
  });

  it("handles complex fallback objects", async () => {
    const fallbackObj = { data: "fallback", count: 42 };
    const result = await withFallback(Promise.reject(new Error("error")), fallbackObj);
    expect(result).toEqual(fallbackObj);
  });

  it("handles promise that resolves to undefined", async () => {
    const result = await withFallback(Promise.resolve(undefined), "fallback");
    expect(result).toBeUndefined();
  });

  it("handles promise that resolves to null", async () => {
    const result = await withFallback(Promise.resolve(null), "fallback");
    expect(result).toBeNull();
  });
});
