import { describe, expect, it, beforeEach } from "vitest";
import { act } from "@testing-library/react";
import {
  DEFAULT_SETTINGS_TAB_KEY,
  useSettingsViewStore,
} from "../settingsViewStore";

describe("settingsViewStore", () => {
  beforeEach(() => {
    act(() => {
      useSettingsViewStore.setState({
        isOpen: false,
        origin: "chat",
        activeTabKey: DEFAULT_SETTINGS_TAB_KEY,
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

    it("should default activeTabKey to provider", () => {
      const state = useSettingsViewStore.getState();
      expect(state.activeTabKey).toBe(DEFAULT_SETTINGS_TAB_KEY);
    });

    it("should have open, close, and setActiveTabKey actions", () => {
      const state = useSettingsViewStore.getState();
      expect(typeof state.open).toBe("function");
      expect(typeof state.close).toBe("function");
      expect(typeof state.setActiveTabKey).toBe("function");
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

    it("should use default tab when none is provided", () => {
      const { open } = useSettingsViewStore.getState();

      act(() => {
        open("chat");
      });

      expect(useSettingsViewStore.getState().activeTabKey).toBe(DEFAULT_SETTINGS_TAB_KEY);
    });

    it("should set provided activeTabKey", () => {
      const { open } = useSettingsViewStore.getState();

      act(() => {
        open("chat", "mcp");
      });

      expect(useSettingsViewStore.getState().activeTabKey).toBe("mcp");
    });
  });

  describe("close action", () => {
    it("should set isOpen to false", () => {
      const { open, close } = useSettingsViewStore.getState();

      act(() => {
        open("chat", "sessions");
      });
      expect(useSettingsViewStore.getState().isOpen).toBe(true);

      act(() => {
        close();
      });
      expect(useSettingsViewStore.getState().isOpen).toBe(false);
    });

    it("should not change origin or activeTabKey", () => {
      const { open, close } = useSettingsViewStore.getState();

      act(() => {
        open("chat", "sessions");
      });

      act(() => {
        close();
      });

      const state = useSettingsViewStore.getState();
      expect(state.origin).toBe("chat");
      expect(state.activeTabKey).toBe("sessions");
    });
  });

  describe("setActiveTabKey", () => {
    it("should update activeTabKey independently", () => {
      const { setActiveTabKey } = useSettingsViewStore.getState();

      act(() => {
        setActiveTabKey("workflows");
      });

      expect(useSettingsViewStore.getState().activeTabKey).toBe("workflows");
    });
  });

  describe("store subscription", () => {
    it("should notify subscribers on open", () => {
      const listener = vi.fn();
      useSettingsViewStore.subscribe(listener);

      const { open } = useSettingsViewStore.getState();
      act(() => {
        open("chat", "provider");
      });

      expect(listener).toHaveBeenCalled();
    });

    it("should notify subscribers on tab change", () => {
      const listener = vi.fn();
      useSettingsViewStore.subscribe(listener);

      const { setActiveTabKey } = useSettingsViewStore.getState();
      act(() => {
        setActiveTabKey("app");
      });

      expect(listener).toHaveBeenCalled();
    });
  });
});
