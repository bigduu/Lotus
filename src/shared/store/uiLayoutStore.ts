import { create } from "zustand";

import { uiLayoutDebug } from "@shared/utils/debugFlags";
import {
  generateId,
  getLeafIdsFromTree,
  getSplitIdsFromTree,
  removeLeafFromTree,
  splitLeafInTree,
  type SplitLayout,
  type UILayoutSnapshotV2,
} from "./uiLayoutStore.types";
import { commitLayoutState, loadInitialLayout } from "./uiLayoutStore.migrations";

// Re-export layout types and pure helpers so existing importers of
// "@shared/store/uiLayoutStore" keep working unchanged.
export { findLeafIdBySessionId, getLeafIdsFromTree } from "./uiLayoutStore.types";
export type {
  InspectorLayout,
  LayoutLeafNode,
  LayoutNode,
  LayoutSplitNode,
  SidebarLayout,
  SplitLayout,
  UILayoutSnapshotV2,
} from "./uiLayoutStore.types";

export type UILayoutState = UILayoutSnapshotV2 & {
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSidebarWidthPx: (widthPx: number) => void;
  setInspectorWidthPx: (widthPx: number) => void;

  setActiveLeafId: (leafId: string) => void;
  setLeafSessionId: (leafId: string, sessionId: string | null) => void;
  clearSessionFromAllLeaves: (sessionId: string) => void;

  splitLeaf: (leafId: string, layout: SplitLayout) => void;
  closeLeaf: (leafId: string) => void;

  setSplitSizesPx: (splitId: string, sizes: [number, number]) => void;
  pruneSplitSizes: () => void;
};

export const useUILayoutStore = create<UILayoutState>((set) => ({
  ...loadInitialLayout(),

  setSidebarCollapsed: (collapsed) => {
    set((state) => {
      if (state.sidebar.collapsed === collapsed) {
        return state;
      }
      return commitLayoutState({
        sidebar: { ...state.sidebar, collapsed },
        inspector: state.inspector,
        tree: state.tree,
        activeLeafId: state.activeLeafId,
        leafSessionIds: state.leafSessionIds,
        splitSizesPx: state.splitSizesPx,
      });
    });
  },

  setSidebarWidthPx: (widthPx) => {
    set((state) => {
      const clamped = Math.max(
        state.sidebar.minWidthPx,
        Math.min(state.sidebar.maxWidthPx, widthPx),
      );
      if (state.sidebar.widthPx === clamped) {
        return state;
      }
      return commitLayoutState({
        sidebar: { ...state.sidebar, widthPx: clamped },
        inspector: state.inspector,
        tree: state.tree,
        activeLeafId: state.activeLeafId,
        leafSessionIds: state.leafSessionIds,
        splitSizesPx: state.splitSizesPx,
      });
    });
  },

  setInspectorWidthPx: (widthPx) => {
    set((state) => {
      const clamped = Math.max(
        state.inspector.minWidthPx,
        Math.min(state.inspector.maxWidthPx, widthPx),
      );
      if (state.inspector.widthPx === clamped) {
        return state;
      }
      return commitLayoutState({
        sidebar: state.sidebar,
        inspector: { ...state.inspector, widthPx: clamped },
        tree: state.tree,
        activeLeafId: state.activeLeafId,
        leafSessionIds: state.leafSessionIds,
        splitSizesPx: state.splitSizesPx,
      });
    });
  },

  setActiveLeafId: (leafId) => {
    set((state) => {
      if (state.activeLeafId === leafId) {
        return state;
      }
      const leafIds = getLeafIdsFromTree(state.tree);
      if (!leafIds.includes(leafId)) return state;

      uiLayoutDebug("setActiveLeafId", {
        from: state.activeLeafId,
        to: leafId,
      });

      return commitLayoutState({
        sidebar: state.sidebar,
        inspector: state.inspector,
        tree: state.tree,
        activeLeafId: leafId,
        leafSessionIds: state.leafSessionIds,
        splitSizesPx: state.splitSizesPx,
      });
    });
  },

  setLeafSessionId: (leafId, sessionId) => {
    set((state) => {
      const leafIds = getLeafIdsFromTree(state.tree);
      if (!leafIds.includes(leafId)) return state;
      if ((state.leafSessionIds[leafId] ?? null) === sessionId) {
        return state;
      }

      const duplicatedLeafIds: string[] = [];
      uiLayoutDebug("setLeafSessionId", {
        leafId,
        fromSessionId: state.leafSessionIds[leafId] ?? null,
        toSessionId: sessionId,
        mode: "unique_session_per_leaf",
      });

      const nextLeafSessionIds: Record<string, string | null> = {
        ...state.leafSessionIds,
        [leafId]: sessionId,
      };

      // Enforce one-to-one mapping: one session can only be visible in one pane.
      // Reassigning a session to a new leaf clears it from all other leaves.
      if (sessionId) {
        for (const id of leafIds) {
          if (id === leafId) continue;
          if (nextLeafSessionIds[id] === sessionId) {
            nextLeafSessionIds[id] = null;
            duplicatedLeafIds.push(id);
          }
        }
      }

      if (duplicatedLeafIds.length > 0) {
        uiLayoutDebug("setLeafSessionId dedupe", {
          sessionId,
          clearedLeafIds: duplicatedLeafIds,
          assignedLeafId: leafId,
        });
      }

      // Keep mapping limited to current leaves.
      leafIds.forEach((id) => {
        if (!(id in nextLeafSessionIds)) {
          nextLeafSessionIds[id] = null;
        }
      });

      return commitLayoutState({
        sidebar: state.sidebar,
        inspector: state.inspector,
        tree: state.tree,
        activeLeafId: state.activeLeafId,
        leafSessionIds: nextLeafSessionIds,
        splitSizesPx: state.splitSizesPx,
      });
    });
  },

  clearSessionFromAllLeaves: (sessionId) => {
    set((state) => {
      const nextLeafSessionIds: Record<string, string | null> = {
        ...state.leafSessionIds,
      };

      let didChange = false;
      for (const [leafId, mapped] of Object.entries(nextLeafSessionIds)) {
        if (mapped === sessionId) {
          nextLeafSessionIds[leafId] = null;
          didChange = true;
        }
      }

      if (!didChange) {
        return state;
      }

      return commitLayoutState({
        sidebar: state.sidebar,
        inspector: state.inspector,
        tree: state.tree,
        activeLeafId: state.activeLeafId,
        leafSessionIds: nextLeafSessionIds,
        splitSizesPx: state.splitSizesPx,
      });
    });
  },

  splitLeaf: (leafId, layout) => {
    set((state) => {
      const leafIds = getLeafIdsFromTree(state.tree);
      if (!leafIds.includes(leafId)) return state;
      if (leafIds.length >= 4) return state;

      const newSplitId = generateId("split");
      const newLeafId = generateId("pane");

      const nextTree = splitLeafInTree(state.tree, leafId, layout, newSplitId, newLeafId);

      const nextLeafSessionIds: Record<string, string | null> = {
        ...state.leafSessionIds,
        [newLeafId]: null,
      };

      return commitLayoutState({
        sidebar: state.sidebar,
        inspector: state.inspector,
        tree: nextTree,
        // Make the new pane active so the user can pick a chat for it.
        activeLeafId: newLeafId,
        leafSessionIds: nextLeafSessionIds,
        splitSizesPx: state.splitSizesPx,
      });
    });
  },

  closeLeaf: (leafId) => {
    set((state) => {
      const leafIds = getLeafIdsFromTree(state.tree);
      if (!leafIds.includes(leafId)) return state;
      if (leafIds.length <= 1) return state; // don't close the last pane

      const removed = removeLeafFromTree(state.tree, leafId);
      if (!removed.removed || !removed.node) return state;

      const nextTree = removed.node;
      const nextLeafIds = getLeafIdsFromTree(nextTree);
      const nextSplitIds = getSplitIdsFromTree(nextTree);

      const nextLeafSessionIds: Record<string, string | null> = {};
      nextLeafIds.forEach((id) => {
        nextLeafSessionIds[id] = state.leafSessionIds[id] ?? null;
      });

      const nextSplitSizesPx: Record<string, [number, number]> = {};
      nextSplitIds.forEach((splitId) => {
        const sizes = state.splitSizesPx[splitId];
        if (sizes) nextSplitSizesPx[splitId] = sizes;
      });

      const nextActiveLeafId =
        state.activeLeafId === leafId
          ? nextLeafIds[0]
          : nextLeafIds.includes(state.activeLeafId)
            ? state.activeLeafId
            : nextLeafIds[0];

      return commitLayoutState({
        sidebar: state.sidebar,
        inspector: state.inspector,
        tree: nextTree,
        activeLeafId: nextActiveLeafId,
        leafSessionIds: nextLeafSessionIds,
        splitSizesPx: nextSplitSizesPx,
      });
    });
  },

  setSplitSizesPx: (splitId, sizes) => {
    set((state) => {
      const existing = state.splitSizesPx[splitId];
      if (existing && existing[0] === sizes[0] && existing[1] === sizes[1]) {
        return state;
      }
      return commitLayoutState({
        sidebar: state.sidebar,
        inspector: state.inspector,
        tree: state.tree,
        activeLeafId: state.activeLeafId,
        leafSessionIds: state.leafSessionIds,
        splitSizesPx: { ...state.splitSizesPx, [splitId]: sizes },
      });
    });
  },

  pruneSplitSizes: () => {
    set((state) => {
      const splitIds = new Set(getSplitIdsFromTree(state.tree));
      const nextSplitSizesPx: Record<string, [number, number]> = {};
      for (const [splitId, sizes] of Object.entries(state.splitSizesPx)) {
        if (splitIds.has(splitId)) {
          nextSplitSizesPx[splitId] = sizes;
        }
      }

      const prevKeys = Object.keys(state.splitSizesPx);
      const nextKeys = Object.keys(nextSplitSizesPx);
      if (prevKeys.length === nextKeys.length && prevKeys.every((k) => k in nextSplitSizesPx)) {
        return state;
      }

      return commitLayoutState({
        sidebar: state.sidebar,
        inspector: state.inspector,
        tree: state.tree,
        activeLeafId: state.activeLeafId,
        leafSessionIds: state.leafSessionIds,
        splitSizesPx: nextSplitSizesPx,
      });
    });
  },
}));
