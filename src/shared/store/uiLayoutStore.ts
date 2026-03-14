import { create } from "zustand";

import { storageService } from "@services/chat/StorageService";
import { uiLayoutDebug } from "@shared/utils/debugFlags";

/**
 * UI Layout persistence for the chat workspace.
 *
 * Requirements:
 * - Sidebar resizable + collapsible
 * - Chat area supports per-panel split (horizontal/vertical) and close
 * - Max 4 leaf panes (each leaf hosts an independent ChatView + input)
 * - Persist everything (layout tree + split sizes + pane chat assignments)
 */

export type SplitLayout = "horizontal" | "vertical";

export type LayoutLeafNode = {
  type: "leaf";
  id: string;
};

export type LayoutSplitNode = {
  type: "split";
  id: string;
  layout: SplitLayout;
  children: [LayoutNode, LayoutNode];
};

export type LayoutNode = LayoutLeafNode | LayoutSplitNode;

type SidebarLayout = {
  collapsed: boolean;
  /**
   * Expanded width in px. When collapsed, UI should use collapsedWidth instead.
   */
  widthPx: number;
  collapsedWidthPx: number;
  minWidthPx: number;
  maxWidthPx: number;
};

export type UILayoutSnapshotV2 = {
  v: 2;
  sidebar: SidebarLayout;
  tree: LayoutNode;
  activeLeafId: string;
  /**
   * leafId -> sessionId (or null if empty)
   */
  leafSessionIds: Record<string, string | null>;
  /**
   * splitNodeId -> [firstPx, secondPx]
   */
  splitSizesPx: Record<string, [number, number]>;
};

const DEFAULT_SIDEBAR: SidebarLayout = {
  collapsed: false,
  widthPx: 260,
  collapsedWidthPx: 72,
  minWidthPx: 180,
  maxWidthPx: 520,
};

const DEFAULT_LAYOUT_V2: UILayoutSnapshotV2 = {
  v: 2,
  sidebar: DEFAULT_SIDEBAR,
  tree: { type: "leaf", id: "lt" },
  activeLeafId: "lt",
  leafSessionIds: { lt: null },
  splitSizesPx: {},
};

const generateId = (prefix: string): string => {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? (crypto.randomUUID as () => string)()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${rnd}`;
};

export const getLeafIdsFromTree = (node: LayoutNode): string[] => {
  if (node.type === "leaf") return [node.id];
  return [
    ...getLeafIdsFromTree(node.children[0]),
    ...getLeafIdsFromTree(node.children[1]),
  ];
};

const getSplitIdsFromTree = (node: LayoutNode): string[] => {
  if (node.type === "leaf") return [];
  return [
    node.id,
    ...getSplitIdsFromTree(node.children[0]),
    ...getSplitIdsFromTree(node.children[1]),
  ];
};

export const findLeafIdBySessionId = (
  leafSessionIds: Record<string, string | null>,
  sessionId: string,
): string | null => {
  for (const [leafId, mappedSessionId] of Object.entries(leafSessionIds)) {
    if (mappedSessionId === sessionId) return leafId;
  }
  return null;
};

const splitLeafInTree = (
  node: LayoutNode,
  leafId: string,
  layout: SplitLayout,
  newSplitId: string,
  newLeafId: string,
): LayoutNode => {
  if (node.type === "leaf") {
    if (node.id !== leafId) return node;
    return {
      type: "split",
      id: newSplitId,
      layout,
      children: [node, { type: "leaf", id: newLeafId }],
    };
  }

  return {
    ...node,
    children: [
      splitLeafInTree(node.children[0], leafId, layout, newSplitId, newLeafId),
      splitLeafInTree(node.children[1], leafId, layout, newSplitId, newLeafId),
    ],
  };
};

const removeLeafFromTree = (
  node: LayoutNode,
  leafId: string,
): { node: LayoutNode | null; removed: boolean } => {
  if (node.type === "leaf") {
    if (node.id === leafId) return { node: null, removed: true };
    return { node, removed: false };
  }

  const left = removeLeafFromTree(node.children[0], leafId);
  if (left.removed) {
    if (!left.node) {
      // Collapse split: keep sibling
      return { node: node.children[1], removed: true };
    }
    return {
      node: { ...node, children: [left.node, node.children[1]] },
      removed: true,
    };
  }

  const right = removeLeafFromTree(node.children[1], leafId);
  if (right.removed) {
    if (!right.node) {
      return { node: node.children[0], removed: true };
    }
    return {
      node: { ...node, children: [node.children[0], right.node] },
      removed: true,
    };
  }

  return { node, removed: false };
};

const toSnapshot = (state: {
  sidebar: SidebarLayout;
  tree: LayoutNode;
  activeLeafId: string;
  leafSessionIds: Record<string, string | null>;
  splitSizesPx: Record<string, [number, number]>;
}): UILayoutSnapshotV2 => ({
  v: 2,
  sidebar: state.sidebar,
  tree: state.tree,
  activeLeafId: state.activeLeafId,
  leafSessionIds: state.leafSessionIds,
  splitSizesPx: state.splitSizesPx,
});

type PersistableLayoutState = Pick<
  UILayoutSnapshotV2,
  "sidebar" | "tree" | "activeLeafId" | "leafSessionIds" | "splitSizesPx"
>;

const persistLayout = (snapshot: UILayoutSnapshotV2) => {
  try {
    storageService.setLayout(JSON.stringify(snapshot));
  } catch (error) {
    console.warn("[uiLayoutStore] Failed to persist layout:", error);
  }
};

const commitLayoutState = (
  state: PersistableLayoutState,
): UILayoutSnapshotV2 => {
  const snapshot = toSnapshot(state);
  persistLayout(snapshot);
  return snapshot;
};

// ---- Migration from previous v1 shape (best-effort) ----
type UILayoutSnapshotV1 = {
  v: 1;
  sidebar?: Partial<SidebarLayout>;
  split?: Partial<{
    columnsPx: [number, number] | null;
    leftRowsPx: [number, number] | null;
    rightRowsPx: [number, number] | null;
    twoHorizontalPx: [number, number] | null;
    twoVerticalPx: [number, number] | null;
  }>;
  view?: Partial<{
    mode: "single" | "two" | "four";
    twoDirection: "horizontal" | "vertical";
  }>;
  panes?: Partial<{
    activePaneId: "lt" | "lb" | "rt" | "rb";
    sessionIds: Record<"lt" | "lb" | "rt" | "rb", string | null>;
  }>;
};

const migrateV1ToV2 = (v1: UILayoutSnapshotV1): UILayoutSnapshotV2 => {
  const sidebar: SidebarLayout = { ...DEFAULT_SIDEBAR, ...(v1.sidebar || {}) };

  const mode = v1.view?.mode ?? "single";
  const twoDirection = v1.view?.twoDirection ?? "horizontal";

  const leafSessionIds: Record<string, string | null> = {
    ...(v1.panes?.sessionIds || {}),
  } as any;

  const activeLeafId = v1.panes?.activePaneId ?? "lt";

  const splitSizesPx: Record<string, [number, number]> = {};

  if (mode === "single") {
    return {
      v: 2,
      sidebar,
      tree: { type: "leaf", id: "lt" },
      activeLeafId: activeLeafId === "lt" ? "lt" : "lt",
      leafSessionIds: { lt: leafSessionIds.lt ?? null },
      splitSizesPx: {},
    };
  }

  if (mode === "two") {
    const splitId = "split-root";
    const layout: SplitLayout = twoDirection;
    const tree: LayoutNode =
      layout === "horizontal"
        ? {
            type: "split",
            id: splitId,
            layout,
            children: [
              { type: "leaf", id: "lt" },
              { type: "leaf", id: "rt" },
            ],
          }
        : {
            type: "split",
            id: splitId,
            layout,
            children: [
              { type: "leaf", id: "lt" },
              { type: "leaf", id: "lb" },
            ],
          };

    const sizes =
      layout === "horizontal"
        ? v1.split?.twoHorizontalPx || v1.split?.columnsPx || null
        : v1.split?.twoVerticalPx || v1.split?.leftRowsPx || null;

    if (sizes) {
      splitSizesPx[splitId] = sizes;
    }

    const leafIds = getLeafIdsFromTree(tree);
    return {
      v: 2,
      sidebar,
      tree,
      activeLeafId: leafIds.includes(activeLeafId) ? activeLeafId : leafIds[0],
      leafSessionIds: Object.fromEntries(
        leafIds.map((id) => [id, leafSessionIds[id] ?? null]),
      ),
      splitSizesPx,
    };
  }

  // four
  const rootId = "split-root";
  const leftId = "split-left";
  const rightId = "split-right";

  const tree: LayoutNode = {
    type: "split",
    id: rootId,
    layout: "horizontal",
    children: [
      {
        type: "split",
        id: leftId,
        layout: "vertical",
        children: [
          { type: "leaf", id: "lt" },
          { type: "leaf", id: "lb" },
        ],
      },
      {
        type: "split",
        id: rightId,
        layout: "vertical",
        children: [
          { type: "leaf", id: "rt" },
          { type: "leaf", id: "rb" },
        ],
      },
    ],
  };

  if (v1.split?.columnsPx) splitSizesPx[rootId] = v1.split.columnsPx;
  if (v1.split?.leftRowsPx) splitSizesPx[leftId] = v1.split.leftRowsPx;
  if (v1.split?.rightRowsPx) splitSizesPx[rightId] = v1.split.rightRowsPx;

  const leafIds = getLeafIdsFromTree(tree);
  return {
    v: 2,
    sidebar,
    tree,
    activeLeafId: leafIds.includes(activeLeafId) ? activeLeafId : leafIds[0],
    leafSessionIds: Object.fromEntries(
      leafIds.map((id) => [id, leafSessionIds[id] ?? null]),
    ),
    splitSizesPx,
  };
};

const safeParseLayout = (raw: string | null): UILayoutSnapshotV2 | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as any;
    if (!parsed || typeof parsed !== "object") return null;

    if (parsed.v === 2) {
      const sidebar: SidebarLayout = {
        ...DEFAULT_SIDEBAR,
        ...(parsed.sidebar || {}),
      };
      const tree: LayoutNode = parsed.tree || DEFAULT_LAYOUT_V2.tree;
      const leafIds = getLeafIdsFromTree(tree);
      const splitIds = getSplitIdsFromTree(tree);

      const leafSessionIds: Record<string, string | null> = {};
      leafIds.forEach((leafId) => {
        leafSessionIds[leafId] =
          typeof parsed.leafSessionIds?.[leafId] === "string"
            ? parsed.leafSessionIds[leafId]
            : null;
      });

      const splitSizesPx: Record<string, [number, number]> = {};
      splitIds.forEach((splitId) => {
        const sizes = parsed.splitSizesPx?.[splitId];
        if (Array.isArray(sizes) && sizes.length >= 2) {
          splitSizesPx[splitId] = [Number(sizes[0]), Number(sizes[1])];
        }
      });

      const activeLeafId =
        typeof parsed.activeLeafId === "string" &&
        leafIds.includes(parsed.activeLeafId)
          ? parsed.activeLeafId
          : leafIds[0];

      return {
        v: 2,
        sidebar,
        tree,
        activeLeafId,
        leafSessionIds,
        splitSizesPx,
      };
    }

    if (parsed.v === 1) {
      return migrateV1ToV2(parsed as UILayoutSnapshotV1);
    }

    return null;
  } catch {
    return null;
  }
};

const loadInitialLayout = (): UILayoutSnapshotV2 => {
  const stored = safeParseLayout(storageService.getLayout());
  return stored ?? DEFAULT_LAYOUT_V2;
};

export type UILayoutState = UILayoutSnapshotV2 & {
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSidebarWidthPx: (widthPx: number) => void;

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

      uiLayoutDebug("setLeafSessionId", {
        leafId,
        fromSessionId: state.leafSessionIds[leafId] ?? null,
        toSessionId: sessionId,
      });

      const nextLeafSessionIds: Record<string, string | null> = {
        ...state.leafSessionIds,
        [leafId]: sessionId,
      };

      // Keep mapping limited to current leaves.
      leafIds.forEach((id) => {
        if (!(id in nextLeafSessionIds)) {
          nextLeafSessionIds[id] = null;
        }
      });

      return commitLayoutState({
        sidebar: state.sidebar,
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

      const nextTree = splitLeafInTree(
        state.tree,
        leafId,
        layout,
        newSplitId,
        newLeafId,
      );

      const nextLeafSessionIds: Record<string, string | null> = {
        ...state.leafSessionIds,
        [newLeafId]: null,
      };

      return commitLayoutState({
        sidebar: state.sidebar,
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
      if (
        prevKeys.length === nextKeys.length &&
        prevKeys.every((k) => k in nextSplitSizesPx)
      ) {
        return state;
      }

      return commitLayoutState({
        sidebar: state.sidebar,
        tree: state.tree,
        activeLeafId: state.activeLeafId,
        leafSessionIds: state.leafSessionIds,
        splitSizesPx: nextSplitSizesPx,
      });
    });
  },
}));
