import { describe, expect, it, vi } from "vitest";

import { ApiError, getErrorMessage, withFallback } from "./errors";

describe("getErrorMessage", () => {
  it("surfaces server-provided message for 500 errors", () => {
    const err = new ApiError("Failed to reload provider: boom", 500, "Internal Server Error");
    expect(getErrorMessage(err)).toBe("Failed to reload provider: boom");
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
