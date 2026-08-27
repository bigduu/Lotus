import React, { useEffect, useMemo, useState } from "react";
import { Flex } from "antd";

import { ResizableSplit } from "@shared/components/ResizableSplit";
import { useUILayoutStore } from "@shared/store/uiLayoutStore";

import { CHAT_OPEN_INSPECTOR_EVENT } from "../components/ChatView/events";
import { ConversationPane } from "../conversation/ConversationPane";
import { SessionInspectorPane } from "../inspector/SessionInspectorPane";
import {
  selectChildren,
  selectIsBusy,
  selectSessionById,
  useAppStore,
} from "@shared/store/appStore";
import { useExperienceModeStore } from "@shared/store/experienceModeStore";
import { isAssistantToolResultMessage } from "@shared/types/chat";
import type { SessionDiffSummary } from "../components/ChatView/ActiveToolMessageCard";
import {
  getFileChangeDiffStats,
  parseFileChangeResultPayload,
} from "@shared/utils/resultFormatters";
import { useIsMobile } from "@shared/hooks/useMediaQuery";
import { buildConversationWorkspaceState, type ConversationWorkspaceState } from "./workspaceState";
import { useWorkflowRuns } from "../../../features/workflows/useWorkflowRuns";

export type SessionWorkspaceShellProps = {
  /**
   * If omitted, falls back to the globally selected chat.
   * When rendering a non-root workspace leaf, always pass an explicit sessionId.
   */
  sessionId?: string | null;
  /**
   * When embedded in split panes, use full width and tighter spacing.
   */
  embedded?: boolean;
  /**
   * Legacy fallback for deriving visible-leaf workspace context when explicit workspaceState is not supplied.
   */
  paneCount?: number;
  /**
   * Preferred explicit workspace state when available.
   */
  workspaceState?: ConversationWorkspaceState;
};

export const SessionWorkspaceShell: React.FC<SessionWorkspaceShellProps> = ({
  sessionId: sessionIdProp,
  embedded = false,
  paneCount = 1,
  workspaceState: workspaceStateProp,
}) => {
  const visibleLeafCount = paneCount;
  const isMobile = useIsMobile();
  const sessionId = useAppStore((state) => sessionIdProp ?? state.currentSessionId);
  const currentChat = useAppStore(selectSessionById(sessionId));
  const currentMessages = useMemo(() => currentChat?.messages || [], [currentChat]);
  const agentAvailability = useAppStore((state) => state.agentAvailability);
  const activeWorkflow = currentChat?.activeWorkflow;
  const workflowActivationKey = activeWorkflow
    ? JSON.stringify([
        activeWorkflow.id,
        activeWorkflow.revision,
        activeWorkflow.activatedAt,
        activeWorkflow.status,
      ])
    : null;
  const workflowRuns = useWorkflowRuns(sessionId, {
    availability: agentAvailability,
    activationKey: workflowActivationKey,
  });
  const loadTaskList = useAppStore((state) => state.loadTaskList);
  const isAdvancedMode = useExperienceModeStore((state) => state.isAdvanced);

  const sharedTaskSessionId = useMemo(() => {
    if (!sessionId || !currentChat) return sessionId;
    if (currentChat.kind === "child") {
      return currentChat.parentSessionId || currentChat.rootSessionId || sessionId;
    }
    return sessionId;
  }, [currentChat, sessionId]);

  const hasTaskList = useAppStore((state) =>
    sharedTaskSessionId ? Boolean(state.taskLists[sharedTaskSessionId]) : false,
  );
  const isBusy = useAppStore(selectIsBusy(sessionId));
  const shouldShowTaskPanel = useMemo(() => {
    if (!sessionId || !currentChat) return false;
    if (hasTaskList) return true;
    if (currentChat.kind === "child") return true;
    if (isBusy) return true;
    return false;
  }, [currentChat, hasTaskList, isBusy, sessionId]);

  const hasSubAgents = useAppStore((state) => {
    if (!sessionId) return false;
    const children = selectChildren(sessionId)(state);
    if (Object.keys(children).length > 0) return true;
    return state.chats.some((c) => c.kind === "child" && c.parentSessionId === sessionId);
  });

  useEffect(() => {
    if (!sharedTaskSessionId || hasTaskList) return;
    if (!shouldShowTaskPanel) return;
    void loadTaskList(sharedTaskSessionId).catch((error) => {
      console.warn(
        `[SessionWorkspaceShell] Failed to load task list for ${sharedTaskSessionId}:`,
        error,
      );
    });
  }, [sharedTaskSessionId, hasTaskList, shouldShowTaskPanel, loadTaskList]);

  const sessionDiffSummary = useMemo<SessionDiffSummary | null>(() => {
    if (!currentMessages || currentMessages.length === 0) {
      return null;
    }

    const files = new Map<
      string,
      {
        added: number;
        removed: number;
        diffChunks: string[];
        truncated: boolean;
        toolCount: number;
        workspace?: string;
      }
    >();
    let totalAdded = 0;
    let totalRemoved = 0;
    let changedTools = 0;

    for (const msg of currentMessages) {
      if (!isAssistantToolResultMessage(msg)) continue;

      const content = msg.result?.result ?? "";
      const payload = parseFileChangeResultPayload(content);
      const diffStats = getFileChangeDiffStats(content);
      if (!payload || !diffStats) continue;

      changedTools += 1;
      totalAdded += diffStats.added;
      totalRemoved += diffStats.removed;

      const existing = files.get(payload.file_path);
      if (existing) {
        existing.added += diffStats.added;
        existing.removed += diffStats.removed;
        existing.diffChunks.push(payload.diff.unified);
        existing.truncated = existing.truncated || Boolean(payload.diff.truncated);
        existing.toolCount += 1;
        existing.workspace = existing.workspace ?? payload.workspace;
      } else {
        files.set(payload.file_path, {
          added: diffStats.added,
          removed: diffStats.removed,
          diffChunks: [payload.diff.unified],
          truncated: Boolean(payload.diff.truncated),
          toolCount: 1,
          workspace: payload.workspace,
        });
      }
    }

    if (files.size === 0) {
      return null;
    }

    const fileSummaries = Array.from(files.entries())
      .map(([filePath, stats]) => ({
        filePath,
        added: stats.added,
        removed: stats.removed,
        unifiedDiff: stats.diffChunks.join("\n\n"),
        truncated: stats.truncated,
        toolCount: stats.toolCount,
        workspace: stats.workspace,
      }))
      .sort((a, b) => a.filePath.localeCompare(b.filePath));

    return {
      totalAdded,
      totalRemoved,
      files: fileSummaries,
      changedTools,
    };
  }, [currentMessages]);

  const inspectorWidthPx = useUILayoutStore((state) => state.inspector.widthPx);
  const inspectorMinWidthPx = useUILayoutStore((state) => state.inspector.minWidthPx);
  const inspectorMaxWidthPx = useUILayoutStore((state) => state.inspector.maxWidthPx);
  const setInspectorWidthPx = useUILayoutStore((state) => state.setInspectorWidthPx);

  const hasMessages = currentMessages.length > 0;
  const hasActiveWorkflow = Boolean(currentChat?.activeWorkflow);
  const hasWorkflowRuns = workflowRuns.runs.length > 0;
  const hasGoalConfig = Boolean(
    currentChat?.config?.goldConfig &&
      ((currentChat.config.goldConfig.evaluation_prompt?.trim()?.length ?? 0) > 0 ||
        currentChat.config.goldConfig.enabled === true),
  );
  const resolvedWorkspaceState = useMemo<ConversationWorkspaceState>(() => {
    if (workspaceStateProp) {
      return workspaceStateProp;
    }

    return buildConversationWorkspaceState({
      isEmbedded: embedded,
      leafCount: visibleLeafCount,
      isMobileViewport: isMobile,
    });
  }, [embedded, isMobile, visibleLeafCount, workspaceStateProp]);

  const inspectorMode = resolvedWorkspaceState.inspectorMode;
  const inspectorEligible = Boolean(
    sessionId &&
      ((isAdvancedMode && hasMessages) ||
        hasGoalConfig ||
        hasActiveWorkflow ||
        hasWorkflowRuns ||
        shouldShowTaskPanel ||
        hasSubAgents ||
        sessionDiffSummary),
  );
  const showInspectorPane = Boolean(sessionId) && (inspectorMode === "drawer" || inspectorEligible);
  const [inspectorOpen, setInspectorOpen] = useState(() => inspectorMode === "rail");
  const [auxReady, setAuxReady] = useState(false);

  useEffect(() => {
    setInspectorOpen(inspectorMode === "rail" ? inspectorEligible : false);
  }, [inspectorEligible, inspectorMode, sessionId]);

  useEffect(() => {
    if (typeof requestIdleCallback === "function") {
      const handle = requestIdleCallback(() => setAuxReady(true));
      return () => cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(() => setAuxReady(true), 300);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !sessionId) return;

    const onOpenInspector = (event: Event) => {
      const customEvent = event as CustomEvent<{ sessionId?: string | null }>;
      const targetSessionId = customEvent.detail?.sessionId ?? null;
      if (targetSessionId !== sessionId) return;
      setInspectorOpen(true);
    };

    window.addEventListener(CHAT_OPEN_INSPECTOR_EVENT, onOpenInspector as EventListener);
    return () => {
      window.removeEventListener(CHAT_OPEN_INSPECTOR_EVENT, onOpenInspector as EventListener);
    };
  }, [sessionId]);

  return (
    <div
      data-session-workspace-shell
      data-inspector-mode={inspectorMode}
      data-multi-pane={resolvedWorkspaceState.isMultiPane ? "true" : "false"}
      data-inspector-toggle-placement={resolvedWorkspaceState.inspectorTogglePlacement}
      style={{
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Flex style={{ flex: 1, minHeight: 0 }}>
        {showInspectorPane && inspectorMode === "rail" && inspectorOpen ? (
          <ResizableSplit
            layout="horizontal"
            sizesPx={[0, inspectorWidthPx]}
            minFirstPx={360}
            minSecondPx={inspectorMinWidthPx}
            maxSecondPx={inspectorMaxWidthPx}
            // The inspector is auxiliary: never let it exceed 40% of the row, so
            // the conversation always stays the larger pane regardless of window
            // size or a previously-dragged width.
            maxSecondFraction={0.4}
            style={{ flex: 1, minHeight: 0 }}
            handleSizePx={4}
            onResizeEnd={([, secondPx]) => {
              const clamped = Math.max(
                inspectorMinWidthPx,
                Math.min(inspectorMaxWidthPx, secondPx),
              );
              setInspectorWidthPx(clamped);
            }}
            first={
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <ConversationPane
                  sessionId={sessionId}
                  embedded={embedded}
                  paneCount={visibleLeafCount}
                  auxReady={auxReady}
                  sessionDiffSummary={sessionDiffSummary}
                  workspaceState={resolvedWorkspaceState}
                  inspectorEligible={inspectorEligible}
                  onRequestOpenInspector={() => setInspectorOpen(true)}
                />
              </div>
            }
            second={
              <SessionInspectorPane
                sessionId={sessionId}
                auxReady={auxReady}
                mode={inspectorMode}
                open={inspectorOpen}
                onOpenChange={setInspectorOpen}
                showMessagesView={hasMessages}
                shouldShowTaskPanel={shouldShowTaskPanel}
                hasSubAgents={hasSubAgents}
                sessionDiffSummary={sessionDiffSummary}
                workflowRuns={workflowRuns}
              />
            }
          />
        ) : (
          <>
            <div
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <ConversationPane
                sessionId={sessionId}
                embedded={embedded}
                paneCount={visibleLeafCount}
                auxReady={auxReady}
                sessionDiffSummary={sessionDiffSummary}
                workspaceState={resolvedWorkspaceState}
                inspectorEligible={inspectorEligible}
                onRequestOpenInspector={() => setInspectorOpen(true)}
              />
            </div>
            {showInspectorPane ? (
              <SessionInspectorPane
                sessionId={sessionId}
                auxReady={auxReady}
                mode={inspectorMode}
                open={inspectorOpen}
                onOpenChange={setInspectorOpen}
                showMessagesView={hasMessages}
                shouldShowTaskPanel={shouldShowTaskPanel}
                hasSubAgents={hasSubAgents}
                sessionDiffSummary={sessionDiffSummary}
                workflowRuns={workflowRuns}
              />
            ) : null}
          </>
        )}
      </Flex>
    </div>
  );
};

export default SessionWorkspaceShell;
