import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { Button, Flex, Tag, theme, Typography } from "antd";
import {
  AppstoreOutlined,
  BorderHorizontalOutlined,
  BorderVerticleOutlined,
  CheckSquareOutlined,
  CloseOutlined,
} from "@ant-design/icons";

import { selectSessionById, useAppStore } from "../../store";
import { ChatView } from "../ChatView";
const LazyHomeDashboard = React.lazy(() =>
  import("../HomeDashboard").then((m) => ({ default: m.HomeDashboard })),
);
import {
  type LayoutNode,
  type LayoutSplitNode,
  getLeafIdsFromTree,
  useUILayoutStore,
} from "@shared/store/uiLayoutStore";
import { ResizableSplit } from "@shared/components/ResizableSplit";
import { uiLayoutDebug } from "@shared/utils/debugFlags";
import { ErrorBoundary } from "@shared/components/ErrorBoundary";
import {
  CHAT_OPEN_INSPECTOR_EVENT,
  CHAT_TOGGLE_BATCH_EXPORT_SELECTION_EVENT,
} from "../ChatView/events";
import { useTranslation } from "react-i18next";
import { useMediaQuery } from "@shared/hooks/useMediaQuery";
import { buildConversationWorkspaceState } from "../../workspace/workspaceState";

import "./styles.css";

const { useToken } = theme;
const { Text } = Typography;

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
  const addChat = useAppStore((s) => s.addChat);
  const systemPrompts = useAppStore((s) => s.systemPrompts);
  const lastSelectedPromptId = useAppStore((s) => s.lastSelectedPromptId);

  const sessionId = leafSessionIds[leafId] ?? null;
  const currentChat = useAppStore(selectSessionById(sessionId));
  const leafIds = useMemo(() => getLeafIdsFromTree(tree), [tree]);
  const leafCount = leafIds.length;
  const paneIndex = Math.max(0, leafIds.indexOf(leafId)) + 1;
  const canSplit = leafCount < MAX_PANES;
  const isMobile = useMediaQuery("(max-width: 768px)");
  const workspaceState = useMemo(
    () =>
      buildConversationWorkspaceState({
        isEmbedded: true,
        leafCount,
        isMobileViewport: isMobile,
      }),
    [isMobile, leafCount],
  );
  /** In multi-leaf mode the close button removes the leaf; otherwise it just clears the session binding. */
  const canCloseLeaf = workspaceState.isMultiPane;
  const canClearSession = Boolean(sessionId);
  const canClose = canCloseLeaf || canClearSession;
  const isMultiLeafWorkspace = workspaceState.isMultiPane;
  const isActive = activeLeafId === leafId;
  const paneTitle = currentChat?.title?.trim() || t("chat.multiPane.selectSessionHint");
  const showPaneHeader = !isMobile;
  const showPaneHeaderInspectorButton =
    workspaceState.inspectorTogglePlacement === "pane_header" && Boolean(sessionId);

  const handleOpenSession = useCallback(
    (sid: string) => {
      setLeafSessionId(leafId, sid);
      setActiveLeafId(leafId);
      selectSession(sid);
    },
    [leafId, selectSession, setActiveLeafId, setLeafSessionId],
  );

  const handleCreateSession = useCallback(async () => {
    const selectedPrompt = systemPrompts.find((p) => p.id === lastSelectedPromptId);
    const systemPromptId =
      selectedPrompt?.id ||
      (systemPrompts.length > 0
        ? systemPrompts.find((p) => p.id === "general_assistant")?.id || systemPrompts[0].id
        : "");

    const newSessionId = await addChat({
      title: t("chat.sidebar.newSession"),
      createdAt: Date.now(),
      messages: [],
      config: {
        systemPromptId,
        baseSystemPrompt:
          selectedPrompt?.content ||
          (systemPrompts.length > 0
            ? systemPrompts.find((p) => p.id === "general_assistant")?.content ||
              systemPrompts[0].content
            : ""),
        lastUsedEnhancedPrompt: null,
      },
    });

    setLeafSessionId(leafId, newSessionId);
    setActiveLeafId(leafId);
  }, [addChat, lastSelectedPromptId, systemPrompts, t, leafId, setLeafSessionId, setActiveLeafId]);

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
        border: isMultiLeafWorkspace
          ? `1px solid ${isActive ? token.colorPrimaryBorder : token.colorBorderSecondary}`
          : "none",
        borderRadius: isMultiLeafWorkspace ? token.borderRadiusLG : 0,
        overflow: "hidden",
        background: token.colorBgContainer,
        position: "relative",
      }}
    >
      {showPaneHeader ? (
        <div
          className="chat-pane-shell__header"
          style={{
            padding: `${token.paddingXS}px ${token.paddingSM}px`,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            background: isMultiLeafWorkspace ? token.colorBgElevated : token.colorBgContainer,
          }}
        >
          <Flex align="center" justify="space-between" gap={token.marginSM} style={{ minWidth: 0 }}>
            <Flex align="center" gap={token.marginXS} style={{ minWidth: 0, flex: 1 }}>
              {isMultiLeafWorkspace ? (
                <Tag color={isActive ? "blue" : "default"} style={{ marginInlineEnd: 0 }}>
                  {t("chat.multiPane.paneLabel", {
                    index: paneIndex,
                    defaultValue: "Pane {{index}}",
                  })}
                </Tag>
              ) : null}
              <div className="chat-pane-shell__title">
                <Text
                  strong={Boolean(sessionId)}
                  type={sessionId ? undefined : "secondary"}
                  ellipsis={{ tooltip: paneTitle }}
                >
                  {paneTitle}
                </Text>
              </div>
            </Flex>

            <Flex className="chat-pane-shell__actions" align="center" gap={4}>
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

              {showPaneHeaderInspectorButton ? (
                <Button
                  size="small"
                  type="text"
                  icon={<AppstoreOutlined />}
                  title={t("chat.workspace.openInspector", {
                    defaultValue: "Open inspector",
                  })}
                  aria-label={t("chat.workspace.openInspector", {
                    defaultValue: "Open inspector",
                  })}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!sessionId) return;
                    window.dispatchEvent(
                      new CustomEvent(CHAT_OPEN_INSPECTOR_EVENT, {
                        detail: { sessionId },
                      }),
                    );
                  }}
                />
              ) : null}

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
                  if (canCloseLeaf) {
                    closeLeaf(leafId);
                  } else {
                    setLeafSessionId(leafId, null);
                  }
                  const next = useUILayoutStore.getState();
                  const nextSessionId = next.leafSessionIds[next.activeLeafId] ?? null;
                  selectSession(nextSessionId);
                }}
              />
            </Flex>
          </Flex>
        </div>
      ) : null}

      <div className="chat-pane-shell__content">
        {sessionId ? (
          <ErrorBoundary name="ChatView">
            <ChatView
              sessionId={sessionId}
              embedded={true}
              paneCount={leafCount}
              workspaceState={workspaceState}
            />
          </ErrorBoundary>
        ) : (
          <ErrorBoundary name="HomeDashboard">
            <React.Suspense fallback={null}>
              <LazyHomeDashboard
                onOpenSession={handleOpenSession}
                onCreateSession={handleCreateSession}
              />
            </React.Suspense>
          </ErrorBoundary>
        )}
      </div>
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

  const chatIdsRaw = useAppStore((s) => s.chats.map((c) => c.id).join(","));
  const sessionIdSet = useMemo(() => new Set(chatIdsRaw.split(",")), [chatIdsRaw]);
  const currentSessionId = useAppStore((s) => s.currentSessionId);

  const didSeedInitialChatRef = useRef(false);
  const leafIds = useMemo(() => getLeafIdsFromTree(tree), [tree]);

  useEffect(() => {
    if (leafIds.length === 0) return;
    if (!leafIds.includes(activeLeafId)) {
      setActiveLeafId(leafIds[0]);
    }
  }, [activeLeafId, leafIds, setActiveLeafId]);

  useEffect(() => {
    const mappedSessionIds = new Set(Object.values(leafSessionIds).filter(Boolean) as string[]);
    let needsUpdate = false;
    for (const sid of mappedSessionIds) {
      if (!sessionIdSet.has(sid)) {
        needsUpdate = true;
        break;
      }
    }
    if (!needsUpdate) return;

    for (const [leafId, mappedSessionId] of Object.entries(leafSessionIds)) {
      if (mappedSessionId && !sessionIdSet.has(mappedSessionId)) {
        setLeafSessionId(leafId, null);
      }
    }
  }, [sessionIdSet, leafSessionIds, setLeafSessionId]);

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
