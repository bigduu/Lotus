import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import {
  appendAssistantReasoningChunk,
  appendAssistantStreamingChunk,
  clearAssistantStreamingState,
  flushAssistantStreamingChunks,
  getAssistantStreamingState,
  setAssistantStreamingState,
} from "./assistantStreamingAtoms";
import { useThrottledValue } from "./useThrottledValue";

describe("assistantStreamingAtoms — chunk batching (#166)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearAssistantStreamingState("s1");
  });

  afterEach(() => {
    flushAssistantStreamingChunks();
    vi.useRealTimers();
  });

  it("coalesces per-token appends into one batched state write", () => {
    appendAssistantStreamingChunk("s1", "Hello");
    appendAssistantStreamingChunk("s1", " ");
    appendAssistantStreamingChunk("s1", "world");

    // Nothing is written until the flush window elapses.
    expect(getAssistantStreamingState("s1").content).toBe("");

    vi.advanceTimersByTime(60);
    expect(getAssistantStreamingState("s1").content).toBe("Hello world");
  });

  it("batches reasoning chunks independently", () => {
    appendAssistantReasoningChunk("s1", "think");
    appendAssistantReasoningChunk("s1", "ing");
    vi.advanceTimersByTime(60);

    const state = getAssistantStreamingState("s1");
    expect(state.reasoningContent).toBe("thinking");
    expect(state.content).toBe("");
  });

  it("flushes buffered chunks before an authoritative set", () => {
    appendAssistantStreamingChunk("s1", "partial");
    setAssistantStreamingState("s1", { content: "final" });

    // The set wins; the buffered chunk landed first and was overwritten.
    expect(getAssistantStreamingState("s1").content).toBe("final");
  });

  it("drops pending chunks on clear", () => {
    appendAssistantStreamingChunk("s1", "partial");
    clearAssistantStreamingState("s1");
    vi.advanceTimersByTime(60);

    expect(getAssistantStreamingState("s1").content).toBe("");
  });
});

describe("useThrottledValue (#166)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes on the leading edge once the window has passed, and coalesces the burst", () => {
    const { result, rerender } = renderHook(({ value }) => useThrottledValue(value, 100), {
      initialProps: { value: "a" },
    });

    expect(result.current).toBe("a");

    // Move past the throttle window opened by the mount flush.
    act(() => {
      vi.advanceTimersByTime(150);
    });

    act(() => {
      rerender({ value: "ab" });
    });
    // Leading edge: ≥interval since the last flush — renders immediately.
    expect(result.current).toBe("ab");

    act(() => {
      rerender({ value: "abc" });
      rerender({ value: "abcd" });
    });
    // Inside the window: still the previous flush.
    expect(result.current).toBe("ab");

    // Trailing edge: latest value lands after the interval.
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(result.current).toBe("abcd");
  });

  it("always settles on the final value", () => {
    const { result, rerender } = renderHook(({ value }) => useThrottledValue(value, 100), {
      initialProps: { value: "a" },
    });

    act(() => {
      rerender({ value: "ab" });
      rerender({ value: "abc" });
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toBe("abc");
  });
});
