import { beforeEach, describe, expect, it, vi } from "vitest";

// Lotus #95 introduced the persisted sidebar grouping-mode preference; #134
// switched the default (and only app-level) mode to "project". These tests
// cover the persistence contract directly at the store layer (default value,
// round-trip through localStorage, and sanitizing a corrupted/invalid
// persisted value) — UI-level coverage lives in ChatSidebar.test.tsx.

const LAYOUT_STORAGE_KEY = "copilot_ui_layout_v1";

const baseLayout = (sidebarOverrides: Record<string, unknown> = {}) => ({
  v: 2,
  sidebar: {
    collapsed: false,
    widthPx: 260,
    collapsedWidthPx: 72,
    minWidthPx: 180,
    maxWidthPx: 520,
    ...sidebarOverrides,
  },
  inspector: { widthPx: 360, minWidthPx: 300, maxWidthPx: 560 },
  tree: { type: "leaf", id: "lt" },
  activeLeafId: "lt",
  leafSessionIds: { lt: null },
  splitSizesPx: {},
});

describe("uiLayoutStore sidebar grouping mode (#95)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("defaults to 'project' when nothing is persisted", async () => {
    const { useUILayoutStore } = await import("../uiLayoutStore");
    expect(useUILayoutStore.getState().sidebar.groupingMode).toBe("project");
  });

  it("setSidebarGroupingMode updates state and persists the choice", async () => {
    const { useUILayoutStore } = await import("../uiLayoutStore");

    useUILayoutStore.getState().setSidebarGroupingMode("workspace");
    expect(useUILayoutStore.getState().sidebar.groupingMode).toBe("workspace");

    const persisted = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) || "{}");
    expect(persisted.sidebar.groupingMode).toBe("workspace");
  });

  it("round-trips a persisted 'workspace' choice across a reload", async () => {
    localStorage.setItem(
      LAYOUT_STORAGE_KEY,
      JSON.stringify(baseLayout({ groupingMode: "workspace" })),
    );

    const { useUILayoutStore } = await import("../uiLayoutStore");
    expect(useUILayoutStore.getState().sidebar.groupingMode).toBe("workspace");
  });

  it("sanitizes an invalid/corrupted persisted grouping mode back to the default", async () => {
    localStorage.setItem(
      LAYOUT_STORAGE_KEY,
      JSON.stringify(baseLayout({ groupingMode: "not-a-real-mode" })),
    );

    const { useUILayoutStore } = await import("../uiLayoutStore");
    expect(useUILayoutStore.getState().sidebar.groupingMode).toBe("project");
  });

  it("is a no-op (no redundant persist/state-change) when set to the current value", async () => {
    const { useUILayoutStore } = await import("../uiLayoutStore");

    const before = useUILayoutStore.getState().sidebar;
    useUILayoutStore.getState().setSidebarGroupingMode("project");
    expect(useUILayoutStore.getState().sidebar).toBe(before);
  });
});
