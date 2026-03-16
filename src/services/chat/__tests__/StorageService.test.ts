import { beforeEach, describe, expect, it, vi } from "vitest";
import { StorageService, storageService } from "../StorageService";

describe("StorageService", () => {
  let service: StorageService;

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    service = new StorageService();
  });

  describe("getTheme", () => {
    it("returns null when no theme is set", () => {
      expect(service.getTheme()).toBeNull();
    });

    it("returns stored theme", () => {
      localStorage.setItem("copilot_ui_theme_v1", "dark");
      expect(service.getTheme()).toBe("dark");
    });

    it("handles localStorage errors gracefully", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Mock localStorage.getItem to throw error
      const originalGetItem = localStorage.getItem;
      localStorage.getItem = vi.fn(() => {
        throw new Error("localStorage error");
      });

      const result = service.getTheme();
      expect(result).toBeNull();
      expect(errorSpy).toHaveBeenCalled();

      localStorage.getItem = originalGetItem;
      errorSpy.mockRestore();
    });
  });

  describe("setTheme", () => {
    it("stores theme in localStorage", () => {
      service.setTheme("light");
      expect(localStorage.getItem("copilot_ui_theme_v1")).toBe("light");
    });

    it("overwrites existing theme", () => {
      service.setTheme("light");
      service.setTheme("dark");
      expect(localStorage.getItem("copilot_ui_theme_v1")).toBe("dark");
    });

    it("handles localStorage errors gracefully", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const originalSetItem = localStorage.setItem;
      localStorage.setItem = vi.fn(() => {
        throw new Error("localStorage error");
      });

      expect(() => service.setTheme("dark")).not.toThrow();
      expect(errorSpy).toHaveBeenCalled();

      localStorage.setItem = originalSetItem;
      errorSpy.mockRestore();
    });
  });

  describe("getLayout", () => {
    it("returns null when no layout is set", () => {
      expect(service.getLayout()).toBeNull();
    });

    it("returns stored layout", () => {
      localStorage.setItem("copilot_ui_layout_v1", '{"sidebar":true}');
      expect(service.getLayout()).toBe('{"sidebar":true}');
    });

    it("handles localStorage errors gracefully", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const originalGetItem = localStorage.getItem;
      localStorage.getItem = vi.fn(() => {
        throw new Error("localStorage error");
      });

      const result = service.getLayout();
      expect(result).toBeNull();
      expect(errorSpy).toHaveBeenCalled();

      localStorage.getItem = originalGetItem;
      errorSpy.mockRestore();
    });
  });

  describe("setLayout", () => {
    it("stores layout in localStorage", () => {
      service.setLayout('{"sidebar":true}');
      expect(localStorage.getItem("copilot_ui_layout_v1")).toBe('{"sidebar":true}');
    });

    it("overwrites existing layout", () => {
      service.setLayout('{"sidebar":true}');
      service.setLayout('{"sidebar":false}');
      expect(localStorage.getItem("copilot_ui_layout_v1")).toBe('{"sidebar":false}');
    });

    it("handles localStorage errors gracefully", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const originalSetItem = localStorage.setItem;
      localStorage.setItem = vi.fn(() => {
        throw new Error("localStorage error");
      });

      expect(() => service.setLayout('{"sidebar":true}')).not.toThrow();
      expect(errorSpy).toHaveBeenCalled();

      localStorage.setItem = originalSetItem;
      errorSpy.mockRestore();
    });
  });

  describe("getStorageStats", () => {
    it("returns 0.0 KB when no UI preferences stored", () => {
      const stats = service.getStorageStats();
      expect(stats.estimatedSize).toBe("0.0 KB");
    });

    it("calculates size for UI preferences only", () => {
      localStorage.setItem("copilot_ui_theme_v1", "dark");
      localStorage.setItem("copilot_ui_layout_v1", '{"sidebar":true}');
      localStorage.setItem("other_key", "some other data"); // Should not be counted

      const stats = service.getStorageStats();
      expect(stats.estimatedSize).not.toBe("0.0 KB");
    });

    it("calculates size correctly for multiple items", () => {
      localStorage.setItem("copilot_ui_theme_v1", "dark-mode-theme");
      localStorage.setItem("copilot_ui_layout_v1", '{"sidebar":true,"collapsed":false}');

      const stats = service.getStorageStats();

      // Should be roughly (key + value) * 2 bytes per char
      // theme: ~24 chars * 2 = 48 bytes
      // layout: ~42 chars * 2 = 84 bytes
      // Total: ~132 bytes = ~0.1 KB
      expect(parseFloat(stats.estimatedSize)).toBeGreaterThan(0);
    });

    it("ignores non-UI keys", () => {
      localStorage.setItem("copilot_ui_theme_v1", "dark");
      localStorage.setItem("other_data", "x".repeat(10000));
      localStorage.setItem("another_key", "y".repeat(5000));

      const stats = service.getStorageStats();
      const size = parseFloat(stats.estimatedSize);

      // Should only count the theme, not the large other_data values
      expect(size).toBeLessThan(1); // Should be small (< 1 KB)
    });
  });

  describe("storageService instance", () => {
    it("is a singleton instance", () => {
      expect(storageService).toBeInstanceOf(StorageService);
    });

    it("can be used to get and set values", () => {
      storageService.setTheme("dark");
      expect(storageService.getTheme()).toBe("dark");

      storageService.setLayout('{"sidebar":false}');
      expect(storageService.getLayout()).toBe('{"sidebar":false}');
    });
  });

  describe("integration tests", () => {
    it("manages theme and layout independently", () => {
      service.setTheme("dark");
      service.setLayout('{"sidebar":true}');

      expect(service.getTheme()).toBe("dark");
      expect(service.getLayout()).toBe('{"sidebar":true}');

      service.setTheme("light");
      expect(service.getLayout()).toBe('{"sidebar":true}'); // Layout unchanged
    });

    it("handles multiple updates", () => {
      service.setTheme("dark");
      service.setTheme("light");
      service.setTheme("system");

      expect(service.getTheme()).toBe("system");
    });

    it("provides accurate storage stats after updates", () => {
      service.setTheme("dark");
      const stats1 = service.getStorageStats();

      service.setLayout('{"sidebar":true,"collapsed":false,"width":250}');
      const stats2 = service.getStorageStats();

      const size1 = parseFloat(stats1.estimatedSize);
      const size2 = parseFloat(stats2.estimatedSize);

      expect(size2).toBeGreaterThan(size1);
    });
  });

  describe("edge cases", () => {
    it("handles empty strings", () => {
      service.setTheme("");
      expect(service.getTheme()).toBe("");
    });

    it("handles JSON strings in layout", () => {
      const layout = JSON.stringify({
        sidebar: true,
        width: 300,
        collapsed: false,
      });

      service.setLayout(layout);
      expect(service.getLayout()).toBe(layout);

      // Should be parseable
      const parsed = JSON.parse(service.getLayout()!);
      expect(parsed.sidebar).toBe(true);
    });

    it("handles special characters in theme", () => {
      service.setTheme("dark-mode-v2.0-beta");
      expect(service.getTheme()).toBe("dark-mode-v2.0-beta");
    });

    it("handles unicode in layout", () => {
      service.setLayout('{"name":"设置"}');
      expect(service.getLayout()).toBe('{"name":"设置"}');
    });
  });
});