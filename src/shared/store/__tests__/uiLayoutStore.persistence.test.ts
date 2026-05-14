import { beforeEach, describe, expect, it, vi } from "vitest";

const LAYOUT_STORAGE_KEY = "copilot_ui_layout_v1";

describe("uiLayoutStore persisted inspector normalization", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("upgrades persisted inspector width constraints to the wider defaults", async () => {
    localStorage.setItem(
      LAYOUT_STORAGE_KEY,
      JSON.stringify({
        v: 2,
        sidebar: {
          collapsed: false,
          widthPx: 260,
          collapsedWidthPx: 72,
          minWidthPx: 180,
          maxWidthPx: 520,
        },
        inspector: {
          widthPx: 360,
          minWidthPx: 280,
          maxWidthPx: 640,
        },
        tree: { type: "leaf", id: "lt" },
        activeLeafId: "lt",
        leafSessionIds: { lt: null },
        splitSizesPx: {},
      }),
    );

    const { useUILayoutStore } = await import("../uiLayoutStore");
    const state = useUILayoutStore.getState();

    expect(state.inspector).toEqual({
      widthPx: 420,
      minWidthPx: 420,
      maxWidthPx: 840,
    });
  });
});
