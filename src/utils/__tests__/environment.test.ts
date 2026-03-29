import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  isTauriEnvironment,
  requireDesktopFeature,
  isFeatureAvailable,
  getFeatureDisabledMessage,
  BROWSER_MODE_DISABLED_FEATURES,
} from "../environment";

describe("environment", () => {
  const originalWindow = global.window;
  const deleteWindow = () => {
    Reflect.deleteProperty(globalThis as Record<string, unknown>, "window");
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore window
    if (originalWindow) {
      global.window = originalWindow;
    } else {
      deleteWindow();
    }
  });

  describe("isTauriEnvironment", () => {
    it("should return false when window is undefined", () => {
      deleteWindow();
      expect(isTauriEnvironment()).toBe(false);
    });

    it("should return false when __TAURI_INTERNALS__ is not present", () => {
      global.window = {} as any;
      expect(isTauriEnvironment()).toBe(false);
    });

    it("should return false when __TAURI_INTERNALS__ is undefined", () => {
      global.window = { __TAURI_INTERNALS__: undefined } as any;
      expect(isTauriEnvironment()).toBe(false);
    });

    it("should return false when __TAURI_INTERNALS__ is null", () => {
      global.window = { __TAURI_INTERNALS__: null } as any;
      expect(isTauriEnvironment()).toBe(false);
    });

    it("should return false when __TAURI_INTERNALS__ is 0", () => {
      global.window = { __TAURI_INTERNALS__: 0 } as any;
      expect(isTauriEnvironment()).toBe(false);
    });

    it("should return false when __TAURI_INTERNALS__ is empty string", () => {
      global.window = { __TAURI_INTERNALS__: "" } as any;
      expect(isTauriEnvironment()).toBe(false);
    });

    it("should return true when __TAURI_INTERNALS__ is an object", () => {
      global.window = { __TAURI_INTERNALS__: {} } as any;
      expect(isTauriEnvironment()).toBe(true);
    });

    it("should return true when __TAURI_INTERNALS__ is truthy", () => {
      global.window = { __TAURI_INTERNALS__: { tauri: true } } as any;
      expect(isTauriEnvironment()).toBe(true);
    });
  });

  describe("requireDesktopFeature", () => {
    it("should throw error when not in Tauri environment", () => {
      deleteWindow();
      expect(() => requireDesktopFeature("test-feature")).toThrow(
        '"test-feature" is only available in the desktop application',
      );
    });

    it("should not throw when in Tauri environment", () => {
      global.window = { __TAURI_INTERNALS__: {} } as any;
      expect(requireDesktopFeature("test-feature")).toBeUndefined();
    });

    it("should throw with correct feature name", () => {
      deleteWindow();
      expect(() => requireDesktopFeature("my-special-feature")).toThrow(
        '"my-special-feature" is only available in the desktop application',
      );
    });

    it("should work with empty string feature name", () => {
      deleteWindow();
      expect(() => requireDesktopFeature("")).toThrow(
        '"" is only available in the desktop application',
      );
    });

    it("should work with special characters in feature name", () => {
      deleteWindow();
      expect(() => requireDesktopFeature("feature-with-dashes")).toThrow(
        '"feature-with-dashes" is only available in the desktop application',
      );
    });
  });

  describe("BROWSER_MODE_DISABLED_FEATURES", () => {
    it("should contain setup-wizard feature", () => {
      expect(BROWSER_MODE_DISABLED_FEATURES).toContain("setup-wizard");
    });

    it("should contain native-file-picker feature", () => {
      expect(BROWSER_MODE_DISABLED_FEATURES).toContain("native-file-picker");
    });

    it("should contain system-proxy-config feature", () => {
      expect(BROWSER_MODE_DISABLED_FEATURES).toContain("system-proxy-config");
    });

    it("should have exactly 3 disabled features", () => {
      expect(BROWSER_MODE_DISABLED_FEATURES).toHaveLength(3);
    });

    it("should be readonly array", () => {
      expect(Array.isArray(BROWSER_MODE_DISABLED_FEATURES)).toBe(true);
    });
  });

  describe("isFeatureAvailable", () => {
    it("should return false for disabled feature in browser", () => {
      deleteWindow();
      expect(isFeatureAvailable("setup-wizard")).toBe(false);
    });

    it("should return true for unknown feature values", () => {
      deleteWindow();
      const feature =
        "custom-feature" as unknown as (typeof BROWSER_MODE_DISABLED_FEATURES)[number];
      expect(isFeatureAvailable(feature)).toBe(true);
    });

    it("should return false for setup-wizard in browser mode", () => {
      deleteWindow();
      expect(isFeatureAvailable("setup-wizard")).toBe(false);
    });

    it("should return true for setup-wizard in Tauri mode", () => {
      global.window = { __TAURI_INTERNALS__: {} } as any;
      expect(isFeatureAvailable("setup-wizard")).toBe(true);
    });

    it("should return false for native-file-picker in browser mode", () => {
      deleteWindow();
      expect(isFeatureAvailable("native-file-picker")).toBe(false);
    });

    it("should return true for native-file-picker in Tauri mode", () => {
      global.window = { __TAURI_INTERNALS__: {} } as any;
      expect(isFeatureAvailable("native-file-picker")).toBe(true);
    });

    it("should return false for system-proxy-config in browser mode", () => {
      deleteWindow();
      expect(isFeatureAvailable("system-proxy-config")).toBe(false);
    });

    it("should return true for system-proxy-config in Tauri mode", () => {
      global.window = { __TAURI_INTERNALS__: {} } as any;
      expect(isFeatureAvailable("system-proxy-config")).toBe(true);
    });
  });

  describe("getFeatureDisabledMessage", () => {
    it("should return correct message for feature", () => {
      const message = getFeatureDisabledMessage("test-feature");
      expect(message).toBe(
        '"test-feature" is only available in the desktop application. Please use the Bamboo desktop app for this feature.',
      );
    });

    it("should include feature name in message", () => {
      const message = getFeatureDisabledMessage("setup-wizard");
      expect(message).toContain("setup-wizard");
    });

    it("should mention desktop application", () => {
      const message = getFeatureDisabledMessage("feature");
      expect(message).toContain("desktop application");
    });

    it("should mention Bamboo desktop app", () => {
      const message = getFeatureDisabledMessage("feature");
      expect(message).toContain("Bamboo desktop app");
    });

    it("should work with empty string", () => {
      const message = getFeatureDisabledMessage("");
      expect(message).toBe(
        '"" is only available in the desktop application. Please use the Bamboo desktop app for this feature.',
      );
    });

    it("should work with special characters", () => {
      const message = getFeatureDisabledMessage("feature-with-dashes_and_underscores");
      expect(message).toContain("feature-with-dashes_and_underscores");
    });

    it("should always return same format", () => {
      const features = ["feature1", "feature2", "feature3"];
      features.forEach((feature) => {
        const message = getFeatureDisabledMessage(feature);
        expect(message).toMatch(/^".+" is only available in the desktop application\./);
      });
    });
  });
});
