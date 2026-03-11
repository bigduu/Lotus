import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { openExternalLink } from "../openExternalLink";

describe("openExternalLink", () => {
  const originalOpen = window.open;

  beforeEach(() => {
    vi.restoreAllMocks();
    delete (window as any).__TAURI_INTERNALS__;
  });

  afterEach(() => {
    window.open = originalOpen;
    delete (window as any).__TAURI_INTERNALS__;
  });

  it("uses Tauri shell plugin when running in Tauri environment", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    (window as any).__TAURI_INTERNALS__ = { invoke };

    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

    await openExternalLink("https://example.com");

    expect(invoke).toHaveBeenCalledWith("plugin:shell|open", {
      path: "https://example.com",
    });
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("falls back to window.open in browser mode", async () => {
    const popupRef = { opener: {} as Window | null } as Window;
    const openSpy = vi.spyOn(window, "open").mockReturnValue(popupRef);

    await openExternalLink("https://example.com/docs");

    expect(openSpy).toHaveBeenCalledWith(
      "https://example.com/docs",
      "_blank",
      "noopener,noreferrer",
    );
    expect(popupRef.opener).toBeNull();
  });

  it("does not navigate current page when desktop shell open fails", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("not allowed"));
    (window as any).__TAURI_INTERNALS__ = { invoke };

    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const currentHref = window.location.href;

    await openExternalLink("https://example.com/blocked");

    expect(invoke).toHaveBeenCalledWith("plugin:shell|open", {
      path: "https://example.com/blocked",
    });
    expect(openSpy).toHaveBeenCalledWith(
      "https://example.com/blocked",
      "_blank",
      "noopener,noreferrer",
    );
    expect(window.location.href).toBe(currentHref);
  });
});
