import { describe, expect, it, beforeEach } from "vitest";
import { act } from "@testing-library/react";
import { useSettingsViewStore } from "../settingsViewStore";

describe("settingsViewStore", () => {
  beforeEach(() => {
    // Reset store to initial state
    act(() => {
      useSettingsViewStore.setState({
        isOpen: false,
        origin: "chat",
      });
    });
  });

  describe("initial state", () => {
    it("should have isOpen set to false", () => {
      const state = useSettingsViewStore.getState();
      expect(state.isOpen).toBe(false);
    });

    it("should have origin set to 'chat'", () => {
      const state = useSettingsViewStore.getState();
      expect(state.origin).toBe("chat");
    });

    it("should have open and close actions", () => {
      const state = useSettingsViewStore.getState();
      expect(typeof state.open).toBe("function");
      expect(typeof state.close).toBe("function");
    });
  });

  describe("open action", () => {
    it("should set isOpen to true", () => {
      const { open } = useSettingsViewStore.getState();

      act(() => {
        open("chat");
      });

      expect(useSettingsViewStore.getState().isOpen).toBe(true);
    });

    it("should set origin to provided value", () => {
      const { open } = useSettingsViewStore.getState();

      act(() => {
        open("chat");
      });

      expect(useSettingsViewStore.getState().origin).toBe("chat");
    });

    it("should update both isOpen and origin", () => {
      const { open } = useSettingsViewStore.getState();

      act(() => {
        open("chat");
      });

      const state = useSettingsViewStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.origin).toBe("chat");
    });

    it("should work when called multiple times", () => {
      const { open } = useSettingsViewStore.getState();

      act(() => {
        open("chat");
        open("chat");
        open("chat");
      });

      const state = useSettingsViewStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.origin).toBe("chat");
    });
  });

  describe("close action", () => {
    it("should set isOpen to false", () => {
      const { open, close } = useSettingsViewStore.getState();

      act(() => {
        open("chat");
      });
      expect(useSettingsViewStore.getState().isOpen).toBe(true);

      act(() => {
        close();
      });
      expect(useSettingsViewStore.getState().isOpen).toBe(false);
    });

    it("should not change origin", () => {
      const { open, close } = useSettingsViewStore.getState();

      act(() => {
        open("chat");
      });
      expect(useSettingsViewStore.getState().origin).toBe("chat");

      act(() => {
        close();
      });
      expect(useSettingsViewStore.getState().origin).toBe("chat");
    });

    it("should work when already closed", () => {
      const { close } = useSettingsViewStore.getState();

      expect(useSettingsViewStore.getState().isOpen).toBe(false);

      act(() => {
        close();
      });

      expect(useSettingsViewStore.getState().isOpen).toBe(false);
    });

    it("should work when called multiple times", () => {
      const { open, close } = useSettingsViewStore.getState();

      act(() => {
        open("chat");
      });

      act(() => {
        close();
        close();
        close();
      });

      expect(useSettingsViewStore.getState().isOpen).toBe(false);
    });
  });

  describe("open/close toggle workflow", () => {
    it("should toggle isOpen state", () => {
      const { open, close } = useSettingsViewStore.getState();

      act(() => {
        open("chat");
      });
      expect(useSettingsViewStore.getState().isOpen).toBe(true);

      act(() => {
        close();
      });
      expect(useSettingsViewStore.getState().isOpen).toBe(false);

      act(() => {
        open("chat");
      });
      expect(useSettingsViewStore.getState().isOpen).toBe(true);
    });

    it("should maintain origin when reopening", () => {
      const { open, close } = useSettingsViewStore.getState();

      act(() => {
        open("chat");
      });
      expect(useSettingsViewStore.getState().origin).toBe("chat");

      act(() => {
        close();
      });
      expect(useSettingsViewStore.getState().origin).toBe("chat");

      act(() => {
        open("chat");
      });
      expect(useSettingsViewStore.getState().origin).toBe("chat");
    });
  });

  describe("store subscription", () => {
    it("should notify subscribers on open", () => {
      const listener = vi.fn();
      useSettingsViewStore.subscribe(listener);

      const { open } = useSettingsViewStore.getState();
      act(() => {
        open("chat");
      });

      expect(listener).toHaveBeenCalled();
    });

    it("should notify subscribers on close", () => {
      const { open } = useSettingsViewStore.getState();
      act(() => {
        open("chat");
      });

      const listener = vi.fn();
      useSettingsViewStore.subscribe(listener);

      const { close } = useSettingsViewStore.getState();
      act(() => {
        close();
      });

      expect(listener).toHaveBeenCalled();
    });
  });

  describe("state persistence", () => {
    it("should maintain state between getState calls", () => {
      const { open } = useSettingsViewStore.getState();

      act(() => {
        open("chat");
      });

      const state1 = useSettingsViewStore.getState();
      const state2 = useSettingsViewStore.getState();

      expect(state1.isOpen).toBe(state2.isOpen);
      expect(state1.origin).toBe(state2.origin);
    });

    it("should return same state object reference", () => {
      const state1 = useSettingsViewStore.getState();
      const state2 = useSettingsViewStore.getState();

      expect(state1).toBe(state2);
    });
  });

  describe("setState", () => {
    it("should allow direct state updates via setState", () => {
      act(() => {
        useSettingsViewStore.setState({ isOpen: true });
      });

      expect(useSettingsViewStore.getState().isOpen).toBe(true);
    });

    it("should allow partial state updates", () => {
      act(() => {
        useSettingsViewStore.setState({ isOpen: true });
      });

      const state = useSettingsViewStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.origin).toBe("chat"); // Unchanged
    });

    it("should update origin via setState", () => {
      act(() => {
        useSettingsViewStore.setState({ origin: "chat" });
      });

      expect(useSettingsViewStore.getState().origin).toBe("chat");
    });
  });

  describe("edge cases", () => {
    it("should handle rapid open/close", () => {
      const { open, close } = useSettingsViewStore.getState();

      for (let i = 0; i < 10; i++) {
        act(() => {
          open("chat");
        });
        act(() => {
          close();
        });
      }

      expect(useSettingsViewStore.getState().isOpen).toBe(false);
    });

    it("should handle opening when already open", () => {
      const { open } = useSettingsViewStore.getState();

      act(() => {
        open("chat");
      });
      act(() => {
        open("chat");
      });

      expect(useSettingsViewStore.getState().isOpen).toBe(true);
    });
  });

  describe("type safety", () => {
    it("should have correct types for all state properties", () => {
      const state = useSettingsViewStore.getState();

      expect(typeof state.isOpen).toBe("boolean");
      expect(typeof state.origin).toBe("string");
      expect(typeof state.open).toBe("function");
      expect(typeof state.close).toBe("function");
    });

    it("should accept origin parameter in open action", () => {
      const { open } = useSettingsViewStore.getState();

      // Type check - should compile without error
      act(() => {
        open("chat");
      });

      expect(useSettingsViewStore.getState().origin).toBe("chat");
    });
  });
});
