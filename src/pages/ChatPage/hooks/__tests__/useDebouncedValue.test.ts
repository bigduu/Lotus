import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebouncedValue } from "../useDebouncedValue";

describe("useDebouncedValue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("debouncing behavior", () => {
    it("should return initial value immediately", () => {
      const { result } = renderHook(() => useDebouncedValue("initial"));
      expect(result.current).toBe("initial");
    });

    it("should debounce value changes with default delay (80ms)", () => {
      const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), {
        initialProps: { value: "initial" },
      });

      expect(result.current).toBe("initial");

      rerender({ value: "changed" });
      expect(result.current).toBe("initial"); // Not changed yet

      act(() => {
        vi.advanceTimersByTime(79);
      });
      expect(result.current).toBe("initial"); // Still not changed

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(result.current).toBe("changed"); // Now changed
    });

    it("should debounce with custom delay", () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useDebouncedValue(value, delay),
        { initialProps: { value: "initial", delay: 200 } },
      );

      rerender({ value: "changed", delay: 200 });

      act(() => {
        vi.advanceTimersByTime(199);
      });
      expect(result.current).toBe("initial");

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(result.current).toBe("changed");
    });

    it("should cancel pending update on value change", () => {
      const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), {
        initialProps: { value: "initial" },
      });

      rerender({ value: "first" });
      act(() => {
        vi.advanceTimersByTime(40);
      });

      rerender({ value: "second" });
      act(() => {
        vi.advanceTimersByTime(40);
      });
      expect(result.current).toBe("initial"); // "first" was cancelled

      act(() => {
        vi.advanceTimersByTime(40);
      });
      expect(result.current).toBe("second");
    });

    it("should handle rapid value changes", () => {
      const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), {
        initialProps: { value: "0" },
      });

      // Rapid changes
      for (let i = 1; i <= 10; i++) {
        rerender({ value: i.toString() });
        act(() => {
          vi.advanceTimersByTime(10);
        });
      }

      expect(result.current).toBe("0"); // Not changed yet

      act(() => {
        vi.advanceTimersByTime(80);
      });
      expect(result.current).toBe("10"); // Final value
    });
  });

  describe("cleanup", () => {
    it("should cleanup timer on unmount", () => {
      const { unmount, rerender } = renderHook(({ value }) => useDebouncedValue(value), {
        initialProps: { value: "initial" },
      });

      rerender({ value: "changed" });
      unmount();

      // Should not throw or cause errors
      act(() => {
        vi.advanceTimersByTime(100);
      });
    });

    it("should cleanup previous timer on value change", () => {
      const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), {
        initialProps: { value: "initial" },
      });

      rerender({ value: "first" });
      act(() => {
        vi.advanceTimersByTime(50);
      });

      rerender({ value: "second" });
      act(() => {
        vi.advanceTimersByTime(80);
      });
      expect(result.current).toBe("second");
    });
  });

  describe("different value types", () => {
    it("should debounce number values", () => {
      const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), {
        initialProps: { value: 0 },
      });

      rerender({ value: 42 });
      act(() => {
        vi.advanceTimersByTime(80);
      });
      expect(result.current).toBe(42);
    });

    it("should debounce object values", () => {
      const initial = { name: "initial" };
      const changed = { name: "changed" };

      const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), {
        initialProps: { value: initial },
      });

      rerender({ value: changed });
      act(() => {
        vi.advanceTimersByTime(80);
      });
      expect(result.current).toBe(changed);
    });

    it("should debounce array values", () => {
      const initial = [1, 2, 3];
      const changed = [4, 5, 6];

      const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), {
        initialProps: { value: initial },
      });

      rerender({ value: changed });
      act(() => {
        vi.advanceTimersByTime(80);
      });
      expect(result.current).toBe(changed);
    });

    it("should debounce null values", () => {
      const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), {
        initialProps: { value: "initial" as string | null },
      });

      rerender({ value: null });
      act(() => {
        vi.advanceTimersByTime(80);
      });
      expect(result.current).toBeNull();
    });

    it("should debounce undefined values", () => {
      const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), {
        initialProps: { value: "initial" as string | undefined },
      });

      rerender({ value: undefined });
      act(() => {
        vi.advanceTimersByTime(80);
      });
      expect(result.current).toBeUndefined();
    });

    it("should debounce boolean values", () => {
      const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), {
        initialProps: { value: false },
      });

      rerender({ value: true });
      act(() => {
        vi.advanceTimersByTime(80);
      });
      expect(result.current).toBe(true);
    });
  });

  describe("delay changes", () => {
    it("should update debounce delay when delay prop changes", () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useDebouncedValue(value, delay),
        { initialProps: { value: "initial", delay: 100 } },
      );

      rerender({ value: "changed", delay: 100 });
      act(() => {
        vi.advanceTimersByTime(99);
      });
      expect(result.current).toBe("initial");

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(result.current).toBe("changed");
    });

    it("should handle delay of 0", () => {
      const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 0), {
        initialProps: { value: "initial" },
      });

      rerender({ value: "changed" });
      act(() => {
        vi.advanceTimersByTime(0);
      });
      expect(result.current).toBe("changed");
    });

    it("should handle very long delays", () => {
      const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 5000), {
        initialProps: { value: "initial" },
      });

      rerender({ value: "changed" });
      act(() => {
        vi.advanceTimersByTime(4999);
      });
      expect(result.current).toBe("initial");

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(result.current).toBe("changed");
    });
  });

  describe("edge cases", () => {
    it("should handle same value set multiple times", () => {
      const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), {
        initialProps: { value: "same" },
      });

      rerender({ value: "same" });
      rerender({ value: "same" });
      rerender({ value: "same" });

      act(() => {
        vi.advanceTimersByTime(80);
      });
      expect(result.current).toBe("same");
    });

    it("should handle value changing back to original", () => {
      const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), {
        initialProps: { value: "initial" },
      });

      rerender({ value: "changed" });
      act(() => {
        vi.advanceTimersByTime(40);
      });

      rerender({ value: "initial" });
      act(() => {
        vi.advanceTimersByTime(80);
      });
      expect(result.current).toBe("initial");
    });

    it("should handle empty string value", () => {
      const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), {
        initialProps: { value: "" },
      });

      rerender({ value: "changed" });
      act(() => {
        vi.advanceTimersByTime(80);
      });
      expect(result.current).toBe("changed");
    });

    it("should handle unicode values", () => {
      const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), {
        initialProps: { value: "你好" },
      });

      rerender({ value: "世界" });
      act(() => {
        vi.advanceTimersByTime(80);
      });
      expect(result.current).toBe("世界");
    });
  });

  describe("timer accuracy", () => {
    it("should use window.setTimeout", () => {
      const setTimeoutSpy = vi.spyOn(window, "setTimeout");

      const { rerender } = renderHook(({ value }) => useDebouncedValue(value), {
        initialProps: { value: "initial" },
      });

      rerender({ value: "changed" });
      expect(setTimeoutSpy).toHaveBeenCalled();

      setTimeoutSpy.mockRestore();
    });

    it("should use window.clearTimeout on cleanup", () => {
      const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");

      const { rerender } = renderHook(({ value }) => useDebouncedValue(value), {
        initialProps: { value: "initial" },
      });

      rerender({ value: "first" });
      rerender({ value: "second" }); // Should clear first timer
      expect(clearTimeoutSpy).toHaveBeenCalled();

      clearTimeoutSpy.mockRestore();
    });
  });

  describe("real-world scenarios", () => {
    it("should debounce search input", () => {
      const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
        initialProps: { value: "" },
      });

      // User types "react"
      rerender({ value: "r" });
      act(() => vi.advanceTimersByTime(100));

      rerender({ value: "re" });
      act(() => vi.advanceTimersByTime(100));

      rerender({ value: "rea" });
      act(() => vi.advanceTimersByTime(100));

      rerender({ value: "reac" });
      act(() => vi.advanceTimersByTime(100));

      rerender({ value: "react" });
      expect(result.current).toBe(""); // Not updated yet

      act(() => vi.advanceTimersByTime(300));
      expect(result.current).toBe("react"); // Now updated
    });

    it("should debounce window resize handler", () => {
      const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 150), {
        initialProps: { value: 1024 },
      });

      // Window resizing
      rerender({ value: 1025 });
      act(() => vi.advanceTimersByTime(50));

      rerender({ value: 1026 });
      act(() => vi.advanceTimersByTime(50));

      rerender({ value: 1027 });
      act(() => vi.advanceTimersByTime(50));

      expect(result.current).toBe(1024);

      act(() => vi.advanceTimersByTime(150));
      expect(result.current).toBe(1027);
    });
  });
});
