import {
  DEFAULT_INSPECTOR,
  DEFAULT_LAYOUT_V2,
  DEFAULT_SIDEBAR,
  LAYOUT_STORAGE_KEY,
  getLeafIdsFromTree,
  getSplitIdsFromTree,
  normalizeLeafSessionIds,
  type InspectorLayout,
  type LayoutNode,
  type PersistableLayoutState,
  type SidebarLayout,
  type SplitLayout,
  type UILayoutSnapshotV2,
} from "./uiLayoutStore.types";

export const readStoredLayout = (): string | null => {
  try {
    return localStorage.getItem(LAYOUT_STORAGE_KEY);
  } catch (error) {
    console.warn("[uiLayoutStore] Failed to read persisted layout:", error);
    return null;
  }
};

const toSnapshot = (state: PersistableLayoutState): UILayoutSnapshotV2 => ({
  v: 2,
  sidebar: state.sidebar,
  inspector: state.inspector,
  tree: state.tree,
  activeLeafId: state.activeLeafId,
  leafSessionIds: state.leafSessionIds,
  splitSizesPx: state.splitSizesPx,
});

const persistLayout = (snapshot: UILayoutSnapshotV2) => {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(snapshot));
  } catch (error) {
    console.warn("[uiLayoutStore] Failed to persist layout:", error);
  }
};

export const commitLayoutState = (state: PersistableLayoutState): UILayoutSnapshotV2 => {
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
  const inspector: InspectorLayout = { ...DEFAULT_INSPECTOR };

  const mode = v1.view?.mode ?? "single";
  const twoDirection = v1.view?.twoDirection ?? "horizontal";

  const leafSessionIds: Record<string, string | null> = {
    ...(v1.panes?.sessionIds || {}),
  } as Record<string, string | null>;

  const activeLeafId = v1.panes?.activePaneId ?? "lt";

  const splitSizesPx: Record<string, [number, number]> = {};

  if (mode === "single") {
    return {
      v: 2,
      sidebar,
      inspector,
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
      inspector,
      tree,
      activeLeafId: leafIds.includes(activeLeafId) ? activeLeafId : leafIds[0],
      leafSessionIds: Object.fromEntries(leafIds.map((id) => [id, leafSessionIds[id] ?? null])),
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
    inspector,
    tree,
    activeLeafId: leafIds.includes(activeLeafId) ? activeLeafId : leafIds[0],
    leafSessionIds: Object.fromEntries(leafIds.map((id) => [id, leafSessionIds[id] ?? null])),
    splitSizesPx,
  };
};

export const safeParseLayout = (raw: string | null): UILayoutSnapshotV2 | null => {
  if (!raw) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON.parse returns dynamic shape
    const parsed = JSON.parse(raw) as any;
    if (!parsed || typeof parsed !== "object") return null;

    if (parsed.v === 2) {
      const sidebar: SidebarLayout = {
        ...DEFAULT_SIDEBAR,
        ...(parsed.sidebar || {}),
      };
      const parsedInspector = parsed.inspector || {};
      const mergedInspector: InspectorLayout = {
        ...DEFAULT_INSPECTOR,
        ...parsedInspector,
      };
      const inspectorMinWidthPx = Math.max(
        DEFAULT_INSPECTOR.minWidthPx,
        Number.isFinite(mergedInspector.minWidthPx)
          ? mergedInspector.minWidthPx
          : DEFAULT_INSPECTOR.minWidthPx,
      );
      const inspectorMaxWidthPx = Math.max(
        inspectorMinWidthPx,
        Math.max(
          DEFAULT_INSPECTOR.maxWidthPx,
          Number.isFinite(mergedInspector.maxWidthPx)
            ? mergedInspector.maxWidthPx
            : DEFAULT_INSPECTOR.maxWidthPx,
        ),
      );
      const inspectorWidthPx = Math.max(
        inspectorMinWidthPx,
        Math.min(
          inspectorMaxWidthPx,
          Number.isFinite(mergedInspector.widthPx)
            ? mergedInspector.widthPx
            : DEFAULT_INSPECTOR.widthPx,
        ),
      );
      const inspector: InspectorLayout = {
        widthPx: inspectorWidthPx,
        minWidthPx: inspectorMinWidthPx,
        maxWidthPx: inspectorMaxWidthPx,
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
        typeof parsed.activeLeafId === "string" && leafIds.includes(parsed.activeLeafId)
          ? parsed.activeLeafId
          : leafIds[0];
      const normalizedLeafSessionIds = normalizeLeafSessionIds(leafIds, leafSessionIds);

      return {
        v: 2,
        sidebar,
        inspector,
        tree,
        activeLeafId,
        leafSessionIds: normalizedLeafSessionIds,
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

export const loadInitialLayout = (): UILayoutSnapshotV2 => {
  const stored = safeParseLayout(readStoredLayout());
  return stored ?? DEFAULT_LAYOUT_V2;
};
