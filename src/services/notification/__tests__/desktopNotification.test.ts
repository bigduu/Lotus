import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fireDesktopNotification,
  isAppInBackground,
  sendTestNotification,
} from "../desktopNotification";

type InvokeMock = ReturnType<typeof vi.fn>;

/**
 * Install a fake Tauri `invoke` on `window.__TAURI_INTERNALS__`.
 *
 * `isMainWindowFocused` calls `invoke("is_main_window_focused")` and
 * `invokeShowNotification` calls `invoke("show_desktop_notification", ...)`.
 * `focused` controls the former; the latter is recorded for assertions.
 */
function installTauri(focused: boolean): InvokeMock {
  const invoke: InvokeMock = vi.fn(async (cmd: string) => {
    if (cmd === "is_main_window_focused") {
      return focused;
    }
    return undefined;
  });
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke };
  return invoke;
}

function uninstallTauri(): void {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
}

describe("desktopNotification", () => {
  afterEach(() => {
    uninstallTauri();
    vi.restoreAllMocks();
  });

  describe("isAppInBackground", () => {
    it("returns document.hidden value", () => {
      expect(isAppInBackground()).toBe(document.hidden);
    });
  });

  describe("fireDesktopNotification", () => {
    it("does nothing in browser mode (no Tauri)", async () => {
      // No __TAURI_INTERNALS__ installed.
      await fireDesktopNotification({ title: "T", body: "B" });
      // Nothing to assert beyond no throw; absence of Tauri short-circuits.
      expect(isAppInBackground()).toBe(document.hidden);
    });

    it("shows the notification when the window is not focused", async () => {
      const invoke = installTauri(false);
      await fireDesktopNotification({ title: "Hello", body: "World" });
      expect(invoke).toHaveBeenCalledWith("show_desktop_notification", {
        title: "Hello",
        body: "World",
      });
    });

    it("suppresses the notification when the window is focused", async () => {
      const invoke = installTauri(true);
      await fireDesktopNotification({ title: "Hello", body: "World" });
      expect(invoke).not.toHaveBeenCalledWith("show_desktop_notification", expect.anything());
    });

    it("swallows backend errors", async () => {
      const invoke: InvokeMock = vi.fn(async (cmd: string) => {
        if (cmd === "is_main_window_focused") return false;
        throw new Error("backend unavailable");
      });
      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke };
      await expect(fireDesktopNotification({ title: "T", body: "B" })).resolves.toBeUndefined();
    });
  });

  describe("sendTestNotification", () => {
    it("does nothing in browser mode", async () => {
      await expect(sendTestNotification()).resolves.toBeUndefined();
    });

    it("invokes the backend with the provided title/body", async () => {
      const invoke = installTauri(true);
      await sendTestNotification("My Title", "My Body");
      expect(invoke).toHaveBeenCalledWith("show_desktop_notification", {
        title: "My Title",
        body: "My Body",
      });
    });
  });
});
