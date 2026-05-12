export type ConversationInspectorMode = "rail" | "drawer";

export type ConversationInspectorTogglePlacement = "meta_strip" | "pane_header";

export type ConversationWorkspaceState = {
  /** Whether the chat view is rendered inside a split-pane shell. */
  isEmbedded: boolean;
  /** Total visible leaf panes in the current workspace layout. */
  leafCount: number;
  /** True when the workspace tree currently contains more than one visible leaf pane (the true multi-pane state). */
  isMultiPane: boolean;
  /** Viewport-level mobile signal used by workspace controls. */
  isMobileViewport: boolean;
  /** How the inspector should render in the current layout context. */
  inspectorMode: ConversationInspectorMode;
  /**
   * Where the inspector reopen/open affordance should live.
   * - meta_strip: single-leaf desktop and mobile
   * - pane_header: true multi-pane desktop header, to avoid duplicating controls in the meta strip
   */
  inspectorTogglePlacement: ConversationInspectorTogglePlacement;
};

export type BuildConversationWorkspaceStateArgs = {
  isEmbedded: boolean;
  leafCount: number;
  isMobileViewport: boolean;
};

export const buildConversationWorkspaceState = ({
  isEmbedded,
  leafCount,
  isMobileViewport,
}: BuildConversationWorkspaceStateArgs): ConversationWorkspaceState => {
  const normalizedLeafCount =
    Number.isFinite(leafCount) && leafCount > 0 ? Math.floor(leafCount) : 1;
  const isMultiLeafWorkspace = normalizedLeafCount > 1;
  const inspectorMode: ConversationInspectorMode =
    isMobileViewport || isMultiLeafWorkspace ? "drawer" : "rail";
  const inspectorTogglePlacement: ConversationInspectorTogglePlacement =
    isMultiLeafWorkspace && !isMobileViewport ? "pane_header" : "meta_strip";

  return {
    isEmbedded,
    leafCount: normalizedLeafCount,
    isMultiPane: isMultiLeafWorkspace,
    isMobileViewport,
    inspectorMode,
    inspectorTogglePlacement,
  };
};
