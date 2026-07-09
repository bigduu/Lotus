import { beforeEach, describe, expect, it, vi } from "vitest";

const LAYOUT_STORAGE_KEY = "copilot_ui_layout_v1";

const baseLayout = (inspector: Record<string, number>) => ({
  v: 2,
  sidebar: {
    collapsed: false,
    widthPx: 260,
    collapsedWidthPx: 72,
    minWidthPx: 180,
    maxWidthPx: 520,
  },
  inspector,
  tree: { type: "leaf", id: "lt" },
  activeLeafId: "lt",
  leafSessionIds: { lt: null },
  splitSizesPx: {},
});

describe("uiLayoutStore persisted inspector normalization", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("forces min/max to the design-constant bounds and keeps an in-range width", async () => {
    localStorage.setItem(
      LAYOUT_STORAGE_KEY,
      JSON.stringify(baseLayout({ widthPx: 360, minWidthPx: 280, maxWidthPx: 640 })),
    );

    const { useUILayoutStore } = await import("../uiLayoutStore");

    // min/max are no longer persisted user data — they always reflect the
    // current design constants; only the in-range width is preserved.
    expect(useUILayoutStore.getState().inspector).toEqual({
      widthPx: 360,
      minWidthPx: 300,
      maxWidthPx: 560,
    });
  });

  it("clamps a legacy oversized inspector width down into range", async () => {
    localStorage.setItem(
      LAYOUT_STORAGE_KEY,
      // Legacy footprint (520/420/840) that used to dominate narrow windows.
      JSON.stringify(baseLayout({ widthPx: 800, minWidthPx: 420, maxWidthPx: 840 })),
    );

    const { useUILayoutStore } = await import("../uiLayoutStore");

    expect(useUILayoutStore.getState().inspector).toEqual({
      widthPx: 560,
      minWidthPx: 300,
      maxWidthPx: 560,
    });
  });
});
