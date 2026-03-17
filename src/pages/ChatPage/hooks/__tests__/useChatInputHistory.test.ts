import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChatInputHistory } from "../useChatInputHistory";

describe("useChatInputHistory", () => {
  describe("initial state", () => {
    it("should initialize with correct methods", () => {
      const { result } = renderHook(() => useChatInputHistory("session1"));

      expect(typeof result.current.recordEntry).toBe("function");
      expect(typeof result.current.navigate).toBe("function");
      expect(typeof result.current.acknowledgeManualInput).toBe("function");
      expect(typeof result.current.clearHistory).toBe("function");
    });

    it("should handle null sessionId", () => {
      const { result } = renderHook(() => useChatInputHistory(null));

      act(() => {
        result.current.recordEntry("test");
      });

      const navResult = result.current.navigate("previous", "");
      expect(navResult.value).toBeNull();
      expect(navResult.applied).toBe(false);
    });
  });

  describe("recordEntry", () => {
    it("should record entry for valid session", () => {
      const { result } = renderHook(() => useChatInputHistory("session1"));

      act(() => {
        result.current.recordEntry("Hello world");
      });

      const navResult = result.current.navigate("previous", "");
      expect(navResult.value).toBe("Hello world");
      expect(navResult.applied).toBe(true);
    });

    it("should trim whitespace from entries", () => {
      const { result } = renderHook(() => useChatInputHistory("session1"));

      act(() => {
        result.current.recordEntry("  Hello world  ");
      });

      const navResult = result.current.navigate("previous", "");
      expect(navResult.value).toBe("Hello world");
    });

    it("should not record empty entry", () => {
      const { result } = renderHook(() => useChatInputHistory("session1"));

      act(() => {
        result.current.recordEntry("   ");
      });

      const navResult = result.current.navigate("previous", "");
      expect(navResult.value).toBeNull();
    });

    it("should not record duplicate consecutive entries", () => {
      const { result } = renderHook(() => useChatInputHistory("session1"));

      act(() => {
        result.current.recordEntry("Hello");
        result.current.recordEntry("Hello");
      });

      // Should only have one entry
      act(() => {
        result.current.navigate("previous", "");
      });

      const navResult = result.current.navigate("previous", "");
      expect(navResult.applied).toBe(false);
    });

    it("should maintain separate histories per session", () => {
      const { result: result1 } = renderHook(() =>
        useChatInputHistory("session1"),
      );
      const { result: result2 } = renderHook(() =>
        useChatInputHistory("session2"),
      );

      act(() => {
        result1.current.recordEntry("Session 1");
        result2.current.recordEntry("Session 2");
      });

      const nav1 = result1.current.navigate("previous", "");
      const nav2 = result2.current.navigate("previous", "");

      expect(nav1.value).toBe("Session 1");
      expect(nav2.value).toBe("Session 2");
    });
  });

  describe("navigate - previous", () => {
    it("should navigate to previous entry", () => {
      const { result } = renderHook(() => useChatInputHistory("session1"));

      act(() => {
        result.current.recordEntry("First");
        result.current.recordEntry("Second");
      });

      const nav1 = result.current.navigate("previous", "");
      expect(nav1.value).toBe("Second");
      expect(nav1.applied).toBe(true);

      act(() => {
        result.current.navigate("previous", "");
      });

      const nav2 = result.current.navigate("previous", "");
      expect(nav2.value).toBe("First");
    });

    it("should not navigate previous when current value has content", () => {
      const { result } = renderHook(() => useChatInputHistory("session1"));

      act(() => {
        result.current.recordEntry("First");
      });

      const navResult = result.current.navigate("previous", "Current text");
      expect(navResult.value).toBeNull();
      expect(navResult.applied).toBe(false);
    });

    it("should navigate previous when current value is empty", () => {
      const { result } = renderHook(() => useChatInputHistory("session1"));

      act(() => {
        result.current.recordEntry("First");
      });

      const navResult = result.current.navigate("previous", "");
      expect(navResult.value).toBe("First");
      expect(navResult.applied).toBe(true);
    });

    it("should not navigate past beginning", () => {
      const { result } = renderHook(() => useChatInputHistory("session1"));

      act(() => {
        result.current.recordEntry("First");
      });

      act(() => {
        result.current.navigate("previous", "");
      });

      const navResult = result.current.navigate("previous", "");
      expect(navResult.applied).toBe(false);
    });

    it("should return null when history is empty", () => {
      const { result } = renderHook(() => useChatInputHistory("session1"));

      const navResult = result.current.navigate("previous", "");
      expect(navResult.value).toBeNull();
    });
  });

  describe("navigate - next", () => {
    it("should navigate to next entry after going back", () => {
      const { result } = renderHook(() => useChatInputHistory("session1"));

      act(() => {
        result.current.recordEntry("First");
        result.current.recordEntry("Second");
      });

      // Go back twice
      act(() => {
        result.current.navigate("previous", "");
      });

      act(() => {
        result.current.navigate("previous", "");
      });

      // Go forward once
      let nav1;
      act(() => {
        nav1 = result.current.navigate("next", "");
      });
      expect(nav1.value).toBe("Second");
      expect(nav1.applied).toBe(true);

      // Go forward again (should return empty string for end)
      let nav2;
      act(() => {
        nav2 = result.current.navigate("next", "");
      });
      expect(nav2.value).toBe("");
    });

    it("should return null when not navigating", () => {
      const { result } = renderHook(() => useChatInputHistory("session1"));

      act(() => {
        result.current.recordEntry("First");
      });

      const navResult = result.current.navigate("next", "");
      expect(navResult.value).toBeNull();
    });
  });

  describe("acknowledgeManualInput", () => {
    it("should preserve navigation state when navigation was applied", () => {
      const { result } = renderHook(() => useChatInputHistory("session1"));

      act(() => {
        result.current.recordEntry("First");
        result.current.recordEntry("Second");
      });

      act(() => {
        result.current.navigate("previous", "");
      });

      // Navigation was applied, so acknowledgeManualInput should not reset index
      act(() => {
        result.current.acknowledgeManualInput();
      });

      // Should still be able to navigate
      const navResult = result.current.navigate("previous", "");
      expect(navResult.value).toBe("First");
    });
  });

  describe("clearHistory", () => {
    it("should clear history for current session", () => {
      const { result } = renderHook(() => useChatInputHistory("session1"));

      act(() => {
        result.current.recordEntry("First");
        result.current.recordEntry("Second");
      });

      act(() => {
        result.current.clearHistory();
      });

      const navResult = result.current.navigate("previous", "");
      expect(navResult.value).toBeNull();
    });

    it("should reset navigation state", () => {
      const { result } = renderHook(() => useChatInputHistory("session1"));

      act(() => {
        result.current.recordEntry("First");
      });

      act(() => {
        result.current.navigate("previous", "");
      });

      act(() => {
        result.current.clearHistory();
      });

      const navResult = result.current.navigate("next", "");
      expect(navResult.value).toBeNull();
    });

    it("should not affect other sessions", () => {
      const { result: result1 } = renderHook(() =>
        useChatInputHistory("session1"),
      );
      const { result: result2 } = renderHook(() =>
        useChatInputHistory("session2"),
      );

      act(() => {
        result1.current.recordEntry("Session 1");
        result2.current.recordEntry("Session 2");
      });

      act(() => {
        result1.current.clearHistory();
      });

      const nav1 = result1.current.navigate("previous", "");
      expect(nav1.value).toBeNull();

      const nav2 = result2.current.navigate("previous", "");
      expect(nav2.value).toBe("Session 2");
    });
  });

  describe("session changes", () => {
    it("should reset navigation state when session changes", () => {
      const { result, rerender } = renderHook(
        ({ sessionId }) => useChatInputHistory(sessionId),
        { initialProps: { sessionId: "session1" } },
      );

      act(() => {
        result.current.recordEntry("Session 1 message");
      });

      act(() => {
        result.current.navigate("previous", "");
      });

      rerender({ sessionId: "session2" });

      const navResult = result.current.navigate("next", "");
      expect(navResult.value).toBeNull();
    });

    it("should preserve history when switching back to previous session", () => {
      const { result, rerender } = renderHook(
        ({ sessionId }) => useChatInputHistory(sessionId),
        { initialProps: { sessionId: "session1" } },
      );

      act(() => {
        result.current.recordEntry("Session 1 message");
      });

      rerender({ sessionId: "session2" });

      act(() => {
        result.current.recordEntry("Session 2 message");
      });

      rerender({ sessionId: "session1" });

      const navResult = result.current.navigate("previous", "");
      expect(navResult.value).toBe("Session 1 message");
    });
  });

  describe("edge cases", () => {
    it("should handle special characters in entries", () => {
      const { result } = renderHook(() => useChatInputHistory("session1"));

      const specialEntry = "Hello 🌍 \n\t 'quote' \"double\"";
      act(() => {
        result.current.recordEntry(specialEntry);
      });

      const navResult = result.current.navigate("previous", "");
      expect(navResult.value).toBe(specialEntry);
    });

    it("should handle very long entries", () => {
      const { result } = renderHook(() => useChatInputHistory("session1"));

      const longEntry = "a".repeat(10000);
      act(() => {
        result.current.recordEntry(longEntry);
      });

      const navResult = result.current.navigate("previous", "");
      expect(navResult.value).toBe(longEntry);
    });

    it("should handle unicode and emoji in entries", () => {
      const { result } = renderHook(() => useChatInputHistory("session1"));

      const unicodeEntry = "你好世界 🌍 مرحبا";
      act(() => {
        result.current.recordEntry(unicodeEntry);
      });

      const navResult = result.current.navigate("previous", "");
      expect(navResult.value).toBe(unicodeEntry);
    });
  });
});
