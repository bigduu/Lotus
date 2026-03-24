import React, { useEffect, useMemo, useRef } from "react";
import { Button, Flex, theme } from "antd";
import {
  BorderHorizontalOutlined,
  BorderVerticleOutlined,
  CheckSquareOutlined,
  CloseOutlined,
} from "@ant-design/icons";

import { useAppStore } from "../../store";
import { ChatView } from "../ChatView";
import {
  type LayoutNode,
  type LayoutSplitNode,
  getLeafIdsFromTree,
  useUILayoutStore,
} from "@shared/store/uiLayoutStore";
import { ResizableSplit } from "@shared/components/ResizableSplit";
import { uiLayoutDebug } from "@shared/utils/debugFlags";
import { CHAT_TOGGLE_BATCH_EXPORT_SELECTION_EVENT } from "../ChatView/events";
import { useTranslation } from "react-i18next";

import "./styles.css";

const { useToken } = theme;

const MAX_PANES = 4;

const PaneShell: React.FC<{ leafId: string }> = ({ leafId }) => {
  const { token } = useToken();
  const { t } = useTranslation();

  const tree = useUILayoutStore((s) => s.tree);
  const leafSessionIds = useUILayoutStore((s) => s.leafSessionIds);
  const activeLeafId = useUILayoutStore((s) => s.activeLeafId);
  const setActiveLeafId = useUILayoutStore((s) => s.setActiveLeafId);
  const splitLeaf = useUILayoutStore((s) => s.splitLeaf);
  const closeLeaf = useUILayoutStore((s) => s.closeLeaf);
  const setLeafSessionId = useUILayoutStore((s) => s.setLeafSessionId);

  const selectSession = useAppStore((s) => s.selectSession);

  const sessionId = leafSessionIds[leafId] ?? null;
  const leafCount = useMemo(() => getLeafIdsFromTree(tree).length, [tree]);
  const canSplit = leafCount < MAX_PANES;
  const canClosePane = leafCount > 1;
  const canClearSession = Boolean(sessionId);
  const canClose = canClosePane || canClearSession;
  const hasMultiplePanes = leafCount > 1;
  const isActive = activeLeafId === leafId;

  return (
    <div
      className="chat-pane-shell"
      onMouseDownCapture={() => {
        uiLayoutDebug("pane focus (mouse)", {
          leafId,
          sessionId,
          prevActiveLeafId: activeLeafId,
        });
        setActiveLeafId(leafId);
        if (sessionId) {
          selectSession(sessionId);
        }
      }}
      onFocusCapture={() => {
        uiLayoutDebug("pane focus (focus)", {
          leafId,
          sessionId,
          prevActiveLeafId: activeLeafId,
        });
        setActiveLeafId(leafId);
      }}
      style={{
        height: "100%",
        minHeight: 0,
        border: hasMultiplePanes
          ? `1px solid ${
              isActive ? token.colorPrimaryBorder : token.colorBorderSecondary
            }`
          : "none",
        borderRadius: hasMultiplePanes ? token.borderRadiusLG : 0,
        overflow: "hidden",
        background: token.colorBgContainer,
        position: "relative",
      }}
    >
      <div
        className="chat-pane-actions"
        style={{
          background: token.colorBgElevated,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: 10,
          padding: "2px 4px",
        }}
      >
        <Flex gap={token.marginXS}>
          <Button
            size="small"
            type="text"
            icon={<BorderHorizontalOutlined />}
            disabled={!canSplit}
            title={t("chat.multiPane.splitHorizontal")}
            aria-label={t("chat.multiPane.splitHorizontal")}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              uiLayoutDebug("pane split request", { leafId, layout: "horizontal" });
              splitLeaf(leafId, "horizontal");
              // New pane becomes active; keep global selection consistent.
              const next = useUILayoutStore.getState();
              const nextSessionId = next.leafSessionIds[next.activeLeafId] ?? null;
              if (nextSessionId) selectSession(nextSessionId);
            }}
          />

          <Button
            size="small"
            type="text"
            icon={<BorderVerticleOutlined />}
            disabled={!canSplit}
            title={t("chat.multiPane.splitVertical")}
            aria-label={t("chat.multiPane.splitVertical")}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              uiLayoutDebug("pane split request", { leafId, layout: "vertical" });
              splitLeaf(leafId, "vertical");
              const next = useUILayoutStore.getState();
              const nextSessionId = next.leafSessionIds[next.activeLeafId] ?? null;
              if (nextSessionId) selectSession(nextSessionId);
            }}
          />

          <Button
            size="small"
            type="text"
            icon={<CheckSquareOutlined />}
            disabled={!sessionId}
            title={t("chat.multiPane.selectMessagesToExport")}
            aria-label={t("chat.multiPane.selectMessagesToExport")}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!sessionId) return;
              window.dispatchEvent(
                new CustomEvent(CHAT_TOGGLE_BATCH_EXPORT_SELECTION_EVENT, {
                  detail: { sessionId },
                }),
              );
            }}
          />

          <Button
            size="small"
            type="text"
            danger
            icon={<CloseOutlined />}
            disabled={!canClose}
            title={t("chat.multiPane.closePane")}
            aria-label={t("chat.multiPane.closePane")}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              uiLayoutDebug("pane close request", { leafId });
              if (canClosePane) {
                closeLeaf(leafId);
              } else {
                // Keep the last pane, but allow users to close (clear) its active chat.
                setLeafSessionId(leafId, null);
              }
              const next = useUILayoutStore.getState();
              const nextSessionId = next.leafSessionIds[next.activeLeafId] ?? null;
              selectSession(nextSessionId);
            }}
          />
        </Flex>
      </div>

      {sessionId ? (
        <ChatView sessionId={sessionId} embedded={true} />
      ) : (
        <Flex
          vertical
          align="center"
          justify="center"
          style={{ height: "100%", minHeight: 0, padding: token.paddingLG }}
        >
          <div style={{ color: token.colorTextSecondary }}>
            {t("chat.multiPane.selectSessionHint")}
          </div>
          <div style={{ color: token.colorTextTertiary, fontSize: 12 }}>
            {t("chat.multiPane.hoverToSplitHint")}
          </div>
        </Flex>
      )}
    </div>
  );
};

const SplitNodeView: React.FC<{ node: LayoutSplitNode }> = ({ node }) => {
  const sizes = useUILayoutStore((s) => s.splitSizesPx[node.id] ?? null);
  const setSplitSizesPx = useUILayoutStore((s) => s.setSplitSizesPx);

  return (
    <ResizableSplit
      layout={node.layout}
      sizesPx={sizes}
      defaultSplitRatio={0.5}
      minFirstPx={240}
      minSecondPx={240}
      style={{ height: "100%", minHeight: 0 }}
      onResizeEnd={(nextSizes) => {
        setSplitSizesPx(node.id, nextSizes);
      }}
      first={<LayoutNodeView node={node.children[0]} />}
      second={<LayoutNodeView node={node.children[1]} />}
    />
  );
};

const LayoutNodeView: React.FC<{ node: LayoutNode }> = ({ node }) => {
  if (node.type === "leaf") {
    return <PaneShell leafId={node.id} />;
  }

  return <SplitNodeView node={node} />;
};

export const MultiPaneChatView: React.FC = () => {
  const tree = useUILayoutStore((s) => s.tree);
  const leafSessionIds = useUILayoutStore((s) => s.leafSessionIds);
  const activeLeafId = useUILayoutStore((s) => s.activeLeafId);
  const setActiveLeafId = useUILayoutStore((s) => s.setActiveLeafId);
  const setLeafSessionId = useUILayoutStore((s) => s.setLeafSessionId);
  const clearSessionFromAllLeaves = useUILayoutStore((s) => s.clearSessionFromAllLeaves);

  const chats = useAppStore((s) => s.chats);
  const currentSessionId = useAppStore((s) => s.currentSessionId);

  const didSeedInitialChatRef = useRef(false);
  const leafIds = useMemo(() => getLeafIdsFromTree(tree), [tree]);
  const sessionIdSet = useMemo(() => new Set(chats.map((c) => c.id)), [chats]);

  // Ensure active leaf is always valid.
  useEffect(() => {
    if (leafIds.length === 0) return;
    if (!leafIds.includes(activeLeafId)) {
      setActiveLeafId(leafIds[0]);
    }
  }, [activeLeafId, leafIds, setActiveLeafId]);

  // Prune deleted chats from pane assignments.
  useEffect(() => {
    for (const [leafId, mappedSessionId] of Object.entries(leafSessionIds)) {
      if (mappedSessionId && !sessionIdSet.has(mappedSessionId)) {
        setLeafSessionId(leafId, null);
      }
    }
  }, [sessionIdSet, leafSessionIds, setLeafSessionId]);

  // Seed initial pane assignment once so fresh sessions aren't blank.
  useEffect(() => {
    if (!currentSessionId) return;
    if (didSeedInitialChatRef.current) return;
    const hasAny = Object.values(leafSessionIds).some(Boolean);
    if (!hasAny) {
      setLeafSessionId(activeLeafId, currentSessionId);
      didSeedInitialChatRef.current = true;
      return;
    }
    didSeedInitialChatRef.current = true;
  }, [activeLeafId, currentSessionId, leafSessionIds, setLeafSessionId]);

  // NOTE: We intentionally avoid "two-way binding" between global `currentSessionId`
  // and pane assignments. The sidebar and pane click handlers already coordinate
  // `setLeafSessionId(...)` and `selectSession(...)`. Extra sync effects here can create
  // selection ping-pong (especially during Create New Session) and trigger
  // "Maximum update depth exceeded".

  // Clear assignments for chats when they are deleted via store actions elsewhere.
  useEffect(() => {
    // This is intentionally coarse: it keeps UI layout consistent if some other flow
    // deletes chats without going through ChatSidebar handlers.
    const mappedSessionIds = new Set(
      Object.values(leafSessionIds).filter(Boolean) as string[],
    );
    for (const mappedSessionId of mappedSessionIds) {
      if (!sessionIdSet.has(mappedSessionId)) {
        clearSessionFromAllLeaves(mappedSessionId);
      }
    }
  }, [sessionIdSet, clearSessionFromAllLeaves, leafSessionIds]);

  return (
    <div
      style={{
        height: "100%",
        minHeight: 0,
        padding: 0,
      }}
    >
      <LayoutNodeView node={tree} />
    </div>
  );
};
