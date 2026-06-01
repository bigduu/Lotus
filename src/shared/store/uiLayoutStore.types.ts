/**
 * UI Layout persistence types, defaults, and pure tree helpers for the chat
 * workspace.
 *
 * Requirements:
 * - Sidebar resizable + collapsible
 * - Chat area supports per-panel split (horizontal/vertical) and close
 * - Max 4 leaf panes (each leaf hosts an independent ChatView + input)
 * - Persist everything (layout tree + split sizes + pane chat assignments)
 */

export const LAYOUT_STORAGE_KEY = "copilot_ui_layout_v1";

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

export type SidebarLayout = {
  collapsed: boolean;
  /**
   * Expanded width in px. When collapsed, UI should use collapsedWidth instead.
   */
  widthPx: number;
  collapsedWidthPx: number;
  minWidthPx: number;
  maxWidthPx: number;
};

export type InspectorLayout = {
  widthPx: number;
  minWidthPx: number;
  maxWidthPx: number;
};

export type UILayoutSnapshotV2 = {
  v: 2;
  sidebar: SidebarLayout;
  inspector: InspectorLayout;
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

export type PersistableLayoutState = Pick<
  UILayoutSnapshotV2,
  "sidebar" | "inspector" | "tree" | "activeLeafId" | "leafSessionIds" | "splitSizesPx"
>;

export const DEFAULT_SIDEBAR: SidebarLayout = {
  collapsed: false,
  widthPx: 260,
  collapsedWidthPx: 72,
  minWidthPx: 180,
  maxWidthPx: 520,
};

export const DEFAULT_INSPECTOR: InspectorLayout = {
  widthPx: 520,
  minWidthPx: 420,
  maxWidthPx: 840,
};

export const DEFAULT_LAYOUT_V2: UILayoutSnapshotV2 = {
  v: 2,
  sidebar: DEFAULT_SIDEBAR,
  inspector: DEFAULT_INSPECTOR,
  tree: { type: "leaf", id: "lt" },
  activeLeafId: "lt",
  leafSessionIds: { lt: null },
  splitSizesPx: {},
};

export const generateId = (prefix: string): string => {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? (crypto.randomUUID as () => string)()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${rnd}`;
};

export const getLeafIdsFromTree = (node: LayoutNode): string[] => {
  if (node.type === "leaf") return [node.id];
  return [...getLeafIdsFromTree(node.children[0]), ...getLeafIdsFromTree(node.children[1])];
};

export const getSplitIdsFromTree = (node: LayoutNode): string[] => {
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

export const normalizeLeafSessionIds = (
  leafIds: string[],
  leafSessionIds: Record<string, string | null>,
): Record<string, string | null> => {
  const next: Record<string, string | null> = {};
  const usedSessionIds = new Set<string>();

  leafIds.forEach((leafId) => {
    const mappedSessionId = leafSessionIds[leafId] ?? null;
    if (!mappedSessionId || usedSessionIds.has(mappedSessionId)) {
      next[leafId] = null;
      return;
    }

    usedSessionIds.add(mappedSessionId);
    next[leafId] = mappedSessionId;
  });

  return next;
};

export const splitLeafInTree = (
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

export const removeLeafFromTree = (
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
