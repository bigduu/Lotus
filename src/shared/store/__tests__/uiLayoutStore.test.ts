import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useUILayoutStore } from "../uiLayoutStore";

const resetToTwoPaneLayout = () => {
  act(() => {
    useUILayoutStore.setState({
      sidebar: {
        collapsed: false,
        widthPx: 260,
        collapsedWidthPx: 72,
        minWidthPx: 180,
        maxWidthPx: 520,
      },
      tree: {
        type: "split",
        id: "split-root",
        layout: "horizontal",
        children: [
          { type: "leaf", id: "pane-a" },
          { type: "leaf", id: "pane-b" },
        ],
      },
      activeLeafId: "pane-a",
      leafSessionIds: {
        "pane-a": null,
        "pane-b": null,
      },
      splitSizesPx: {},
    } as any);
  });
};

describe("uiLayoutStore session mapping", () => {
  beforeEach(() => {
    localStorage.clear();
    resetToTwoPaneLayout();
  });

  it("keeps one session bound to only one pane", () => {
    const store = useUILayoutStore.getState();

    act(() => {
      store.setLeafSessionId("pane-a", "session-1");
    });
    expect(useUILayoutStore.getState().leafSessionIds).toEqual({
      "pane-a": "session-1",
      "pane-b": null,
    });

    act(() => {
      store.setLeafSessionId("pane-b", "session-1");
    });
    expect(useUILayoutStore.getState().leafSessionIds).toEqual({
      "pane-a": null,
      "pane-b": "session-1",
    });
  });
});
