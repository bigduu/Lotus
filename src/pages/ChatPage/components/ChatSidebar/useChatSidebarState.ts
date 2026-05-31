import { useCallback, useMemo, useState } from "react";
import { App as AntdApp, Modal } from "antd";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";

import { AgentClient } from "@services/chat/AgentService";

import {
  getChatCountByDate,
  getSessionIdsByDate,
  getDateGroupKeyForChat,
  getSortedDateKeys,
  groupChatsByDate,
} from "../../utils/chatUtils";
import { useSettingsViewStore } from "../../../../shared/store/settingsViewStore";
import { useAppStore } from "../../store";
import type { ChatItem, UserSystemPrompt } from "../../types/chat";
import type { SidebarChatItem } from "../../types/sidebarChat";
import { useUILayoutStore } from "@shared/store/uiLayoutStore";
import { openSession } from "../../utils/openSession";
import { selectIsBusy } from "../../store";

type SidebarStatusFilter = "all" | "pinned" | "running" | "child";

const getSidebarChatKind = (kind: ChatItem["kind"]): SidebarChatItem["kind"] =>
  kind === "child" ? "child" : "root";

const projectSidebarChatItem = (chat: ChatItem): SidebarChatItem => ({
  id: chat.id,
  title: chat.title,
  kind: getSidebarChatKind(chat.kind),
  pinned: Boolean(chat.pinned),
  parentSessionId: chat.parentSessionId || null,
  rootSessionId: chat.rootSessionId || null,
  createdByScheduleId: chat.createdByScheduleId || null,
  updatedAt: chat.updatedAt || null,
  lastRunStatus: chat.lastRunStatus || null,
  lastRunError: chat.lastRunError || null,
  createdAt: chat.createdAt,
  config: {
    systemPromptId: chat.config.systemPromptId,
    workspacePath: chat.config.workspacePath || null,
  },
});

const hasSameSidebarProjection = (prev: SidebarChatItem, chat: ChatItem): boolean =>
  prev.id === chat.id &&
  prev.title === chat.title &&
  prev.kind === getSidebarChatKind(chat.kind) &&
  prev.pinned === Boolean(chat.pinned) &&
  prev.parentSessionId === (chat.parentSessionId || null) &&
  prev.rootSessionId === (chat.rootSessionId || null) &&
  prev.createdByScheduleId === (chat.createdByScheduleId || null) &&
  prev.updatedAt === (chat.updatedAt || null) &&
  prev.lastRunStatus === (chat.lastRunStatus || null) &&
  prev.lastRunError === (chat.lastRunError || null) &&
  prev.createdAt === chat.createdAt &&
  prev.config.systemPromptId === chat.config.systemPromptId &&
  prev.config.workspacePath === (chat.config.workspacePath || null);

const projectSidebarChats = (() => {
  let prevSource: ReadonlyArray<ChatItem> | null = null;
  let prevProjected: SidebarChatItem[] = [];
  let prevById = new Map<string, SidebarChatItem>();

  return (source: ReadonlyArray<ChatItem>): SidebarChatItem[] => {
    if (source === prevSource) {
      return prevProjected;
    }

    const next = source.map((chat) => {
      const prev = prevById.get(chat.id);
      return prev && hasSameSidebarProjection(prev, chat) ? prev : projectSidebarChatItem(chat);
    });

    const unchangedOrderAndRefs =
      next.length === prevProjected.length &&
      next.every((chat, index) => chat === prevProjected[index]);

    prevSource = source;
    prevById = new Map(next.map((chat) => [chat.id, chat]));

    if (unchangedOrderAndRefs) {
      return prevProjected;
    }

    prevProjected = next;
    return next;
  };
})();

/**
 * Build a lightweight searchable string from chat metadata (no message content).
 * This is the fast path for the initial filter; message content is only appended
 * when a term is not found in metadata alone.
 */
const buildMetadataHaystack = (chat: SidebarChatItem): string =>
  [
    chat.title,
    chat.id,
    chat.kind || "root",
    chat.config.workspacePath || "",
    chat.config.systemPromptId || "",
    chat.updatedAt || "",
    chat.createdByScheduleId || "",
    chat.lastRunStatus || "",
    chat.lastRunError || "",
  ]
    .join(" ")
    .toLowerCase();

const buildMessageHaystack = (chat: ChatItem): string =>
  chat.messages
    .filter((m) => m.role === "user" && "content" in m)
    .slice(0, 3)
    .map((m) => ("content" in m ? (m as { content: string }).content : ""))
    .join(" ")
    .toLowerCase();

const matchesSearchQuery = (chat: SidebarChatItem, normalizedQuery: string): boolean => {
  if (!normalizedQuery) return true;

  const terms = normalizedQuery.split(/\s+/).filter(Boolean);

  // Fast path: check metadata-only haystack first
  const meta = buildMetadataHaystack(chat);
  if (terms.every((term) => meta.includes(term))) return true;

  // Slow path: fall back to message content from the live store only when
  // metadata did not match. This keeps sidebar subscriptions decoupled from
  // message streaming/content updates.
  const liveChat = useAppStore.getState().chats.find((item) => item.id === chat.id);
  if (!liveChat) return false;

  const messageHaystack = buildMessageHaystack(liveChat);
  const full = `${meta} ${messageHaystack}`;
  return terms.every((term) => full.includes(term));
};

const matchesStatusFilter = (
  chat: SidebarChatItem,
  filter: SidebarStatusFilter,
  isBusy: (sessionId: string) => boolean,
): boolean => {
  switch (filter) {
    case "pinned":
      return Boolean(chat.pinned);
    case "running":
      return isBusy(chat.id);
    case "child":
      return chat.kind === "child";
    case "all":
    default:
      return true;
  }
};

export const useChatSidebarState = () => {
  const { t } = useTranslation();
  const { message } = AntdApp.useApp();
  const {
    chats,
    currentSessionId,
    deleteSession,
    deleteSessions,
    pinSession,
    unpinSession,
    updateSession,
    addChat,
    refreshChats,
    lastSelectedPromptId,
    systemPrompts,
  } = useAppStore(
    useShallow((state) => ({
      chats: projectSidebarChats(state.chats),
      currentSessionId: state.currentSessionId,
      deleteSession: state.deleteSession,
      deleteSessions: state.deleteSessions,
      pinSession: state.pinSession,
      unpinSession: state.unpinSession,
      updateSession: state.updateSession,
      addChat: state.addChat,
      refreshChats: state.refreshChats,
      lastSelectedPromptId: state.lastSelectedPromptId,
      systemPrompts: state.systemPrompts,
    })),
  );
  // Use selector-based isBusy for consistent semantics with rest of the app.
  const isBusy = useCallback(
    (sessionId: string) => selectIsBusy(sessionId)(useAppStore.getState()),
    [],
  );

  const { sidebarCollapsed, setSidebarCollapsed, clearSessionFromAllLeaves } = useUILayoutStore(
    useShallow((s) => ({
      sidebarCollapsed: s.sidebar.collapsed,
      setSidebarCollapsed: s.setSidebarCollapsed,
      clearSessionFromAllLeaves: s.clearSessionFromAllLeaves,
    })),
  );

  const createNewChat = useCallback(
    async (title?: string, options?: Partial<Omit<ChatItem, "id">>) => {
      const selectedPrompt = systemPrompts.find((p) => p.id === lastSelectedPromptId);

      const systemPromptId =
        selectedPrompt?.id ||
        (systemPrompts.length > 0
          ? systemPrompts.find((p) => p.id === "general_assistant")?.id || systemPrompts[0].id
          : "");

      const newChatData: Omit<ChatItem, "id"> = {
        title: title || t("chat.sidebar.newSession"),
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
          // Do NOT pass model_ref here — let addChat resolve it from provider defaults.
          // selectedModelRef is session-scoped and should not leak into new sessions.
        },
        ...options,
      };
      const newSessionId = await addChat(newChatData);

      // Assign the new chat to the currently active pane (read from store to
      // avoid stale closures when the user just split panes).
      const { activeLeafId: targetLeafId } = useUILayoutStore.getState();
      useUILayoutStore.getState().setLeafSessionId(targetLeafId, newSessionId);
      useUILayoutStore.getState().setActiveLeafId(targetLeafId);
    },
    [addChat, lastSelectedPromptId, systemPrompts, t],
  );

  const [isNewChatSelectorOpen, setIsNewChatSelectorOpen] = useState(false);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set(["Today"]));
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<SidebarStatusFilter>("all");
  const [projectDreamState, setProjectDreamState] = useState<
    Record<string, { status: "loading" | "idle" }>
  >({});

  const selectedSessionMeta = useAppStore(
    useShallow((state) => {
      const sessionId = state.currentSessionId;
      if (!sessionId) return null;

      const chat = state.chats.find((item) => item.id === sessionId);
      if (!chat) return null;

      return {
        id: chat.id,
        kind: chat.kind,
        parentSessionId: chat.parentSessionId || null,
        rootSessionId: chat.rootSessionId || null,
        pinned: Boolean(chat.pinned),
        createdAt: chat.createdAt,
        createdByScheduleId: chat.createdByScheduleId || null,
      };
    }),
  );

  const currentDateGroupKey = useMemo(() => {
    if (!selectedSessionMeta) return null;
    if (selectedSessionMeta.pinned) return "Pinned";
    if (selectedSessionMeta.createdByScheduleId) return "Scheduled";
    return new Date(selectedSessionMeta.createdAt).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }, [selectedSessionMeta]);

  // Always keep the currently selected chat's group expanded, without causing
  // an effect-driven setState loop.
  const expandedKeys = useMemo(() => {
    const next = new Set(expandedDates);
    if (currentDateGroupKey) {
      next.add(currentDateGroupKey);
    }
    return Array.from(next);
  }, [currentDateGroupKey, expandedDates]);

  const handleCollapseChange = (keys: string | string[]) => {
    const next = new Set(Array.isArray(keys) ? keys : [keys]);
    setExpandedDates((prev) => {
      if (prev.size !== next.size) return next;
      for (const k of next) {
        if (!prev.has(k)) return next;
      }
      return prev;
    });
  };

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const hasActiveFilters = normalizedSearchQuery.length > 0 || statusFilter !== "all";

  // ─── Heavy derived data (gated by collapsed state) ─────────────────
  // When the sidebar is collapsed, we return empty / cheap placeholders
  // so that re-renders caused by store updates don't recompute grouping,
  // filtering, or date-sorting work that nobody will see.
  const emptyChatArr = useMemo<SidebarChatItem[]>(() => [], []);
  const emptyChildrenMap = useMemo<Record<string, SidebarChatItem[]>>(() => ({}), []);
  const emptyGrouped = useMemo<Record<string, SidebarChatItem[]>>(() => ({}), []);
  const emptyStrArr = useMemo<string[]>(() => [], []);
  const emptySet = useMemo<Set<string>>(() => new Set(), []);

  // Folder model: sidebar groups only root sessions by date.
  // Child sessions are rendered nested under their root.
  const rootSessions = useMemo(
    () => (sidebarCollapsed ? emptyChatArr : chats.filter((c) => c.kind !== "child")),
    [chats, sidebarCollapsed, emptyChatArr],
  );

  const allChildrenByRoot = useMemo(() => {
    if (sidebarCollapsed) return emptyChildrenMap;
    const map: Record<string, SidebarChatItem[]> = {};
    for (const c of chats) {
      if (c.kind !== "child") continue;
      const rootId = c.parentSessionId || c.rootSessionId;
      if (!rootId) continue;
      if (!map[rootId]) map[rootId] = [];
      map[rootId].push(c);
    }
    Object.keys(map).forEach((rootId) => {
      map[rootId].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        const aTime = Date.parse(a.updatedAt || "") || a.createdAt || 0;
        const bTime = Date.parse(b.updatedAt || "") || b.createdAt || 0;
        return bTime - aTime;
      });
    });
    return map;
  }, [chats, sidebarCollapsed, emptyChildrenMap]);

  const filteredRootSessions = useMemo(() => {
    if (!hasActiveFilters) return rootSessions;

    return rootSessions.filter((rootChat) => {
      const rootMatches =
        matchesSearchQuery(rootChat, normalizedSearchQuery) &&
        matchesStatusFilter(rootChat, statusFilter, isBusy);
      if (rootMatches) return true;

      const childSessions = allChildrenByRoot[rootChat.id] || [];
      return childSessions.some(
        (childChat) =>
          matchesSearchQuery(childChat, normalizedSearchQuery) &&
          matchesStatusFilter(childChat, statusFilter, isBusy),
      );
    });
  }, [
    allChildrenByRoot,
    hasActiveFilters,
    isBusy,
    normalizedSearchQuery,
    rootSessions,
    statusFilter,
  ]);

  const childrenByRoot = useMemo(() => {
    if (!hasActiveFilters) {
      return allChildrenByRoot;
    }

    const map: Record<string, SidebarChatItem[]> = {};
    for (const rootChat of filteredRootSessions) {
      const childSessions = allChildrenByRoot[rootChat.id] || [];
      map[rootChat.id] = childSessions.filter(
        (childChat) =>
          matchesSearchQuery(childChat, normalizedSearchQuery) &&
          matchesStatusFilter(childChat, statusFilter, isBusy),
      );
    }

    return map;
  }, [
    allChildrenByRoot,
    filteredRootSessions,
    hasActiveFilters,
    isBusy,
    normalizedSearchQuery,
    statusFilter,
  ]);

  const groupedChatsByDate = useMemo(
    () => (sidebarCollapsed ? emptyGrouped : groupChatsByDate(filteredRootSessions)),
    [filteredRootSessions, sidebarCollapsed, emptyGrouped],
  );
  const sortedDateKeys = useMemo(
    () => (sidebarCollapsed ? emptyStrArr : getSortedDateKeys(groupedChatsByDate)),
    [groupedChatsByDate, sidebarCollapsed, emptyStrArr],
  );

  const handlePinChat = useCallback(
    (sessionId: string) => {
      pinSession(sessionId);
      // Pinned chats move into the "Pinned" group; expand it so the chat doesn't
      // appear to "disappear" immediately after pinning.
      setExpandedDates((prev) => {
        if (prev.has("Pinned")) return prev;
        const next = new Set(prev);
        next.add("Pinned");
        return next;
      });
    },
    [pinSession],
  );

  const handleUnpinChat = useCallback(
    (sessionId: string) => {
      // Compute the destination group key (best-effort) so the chat remains visible.
      const chat = chats.find((c) => c.id === sessionId);
      const nextGroupKey = chat ? getDateGroupKeyForChat({ ...chat, pinned: false }) : null;

      unpinSession(sessionId);

      if (!nextGroupKey) return;
      setExpandedDates((prev) => {
        if (prev.has(nextGroupKey)) return prev;
        const next = new Set(prev);
        next.add(nextGroupKey);
        return next;
      });
    },
    [chats, unpinSession],
  );

  const handleDelete = (sessionId: string) => {
    Modal.confirm({
      title: t("chat.sidebar.delete.title"),
      content: t("chat.sidebar.delete.confirm"),
      okText: t("common.delete"),
      okType: "danger",
      cancelText: t("common.cancel"),
      onOk: () => {
        clearSessionFromAllLeaves(sessionId);
        deleteSession(sessionId);
      },
    });
  };

  const openSettings = useSettingsViewStore((state) => state.open);

  const handleOpenSettings = () => {
    openSettings("chat");
  };

  const handleSearchQueryChange = useCallback((value: string) => {
    setSearchQuery(value);
  }, []);

  const handleStatusFilterChange = useCallback((value: SidebarStatusFilter) => {
    setStatusFilter(value);
  }, []);

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setStatusFilter("all");
  }, []);

  const handleEditTitle = (sessionId: string, newTitle: string) => {
    updateSession(sessionId, { title: newTitle });
  };

  const handleGenerateTitle = useCallback(async (sessionId: string) => {
    try {
      await AgentClient.getInstance().regenerateSessionTitle(sessionId);
    } catch (error) {
      console.error("Failed to regenerate session title:", error);
    }
  }, []);

  const handleRunProjectDream = useCallback(
    async (sessionId: string) => {
      if (projectDreamState[sessionId]?.status === "loading") {
        return;
      }

      setProjectDreamState((prev) => ({
        ...prev,
        [sessionId]: { status: "loading" },
      }));

      const hide = message.loading(t("chat.actions.runProjectDreamRunning"), 0);
      try {
        const response = await AgentClient.getInstance().runProjectDream(sessionId);
        hide();

        if (response.dream_generated) {
          message.success(t("chat.actions.runProjectDreamSuccess"));
        } else {
          message.info(response.message || t("chat.actions.runProjectDreamNoChange"));
        }

        try {
          await refreshChats();
        } catch (refreshError) {
          console.warn("Failed to refresh chats after project dream run:", refreshError);
        }
      } catch (error) {
        hide();
        const errorMessage =
          error instanceof Error && error.message
            ? error.message
            : t("chat.actions.runProjectDreamFailed");
        message.error(errorMessage);
        console.error("Failed to run project dream:", error);
      } finally {
        setProjectDreamState((prev) => ({
          ...prev,
          [sessionId]: { status: "idle" },
        }));
      }
    },
    [message, projectDreamState, refreshChats, t],
  );

  const handleDeleteByDate = (dateKey: string) => {
    const sessionIds = getSessionIdsByDate(groupedChatsByDate, dateKey);
    const chatCount = getChatCountByDate(groupedChatsByDate, dateKey);

    Modal.confirm({
      title: t("chat.sidebar.deleteByDate.title", { date: dateKey }),
      content: t("chat.sidebar.deleteByDate.confirm", {
        count: chatCount,
        date: dateKey,
      }),
      okText: t("common.delete"),
      okType: "danger",
      cancelText: t("common.cancel"),
      onOk: () => {
        sessionIds.forEach((id) => clearSessionFromAllLeaves(id));
        deleteSessions(sessionIds);
      },
    });
  };

  const handleNewChat = () => {
    setIsNewChatSelectorOpen(true);
  };

  const handleNewChatSelectorClose = () => {
    setIsNewChatSelectorOpen(false);
  };

  const handleSystemPromptSelect = async (preset: UserSystemPrompt) => {
    try {
      await createNewChat(t("chat.sidebar.newSessionWithPrompt", { prompt: preset.name }), {
        config: {
          systemPromptId: preset.id,
          baseSystemPrompt: preset.content,
          lastUsedEnhancedPrompt: null,
        },
      });
      setIsNewChatSelectorOpen(false);
    } catch (error) {
      console.error("Failed to create chat:", error);
      Modal.error({
        title: t("chat.sidebar.createFailedTitle"),
        content: error instanceof Error ? error.message : t("chat.sidebar.createFailedUnknown"),
      });
    }
  };

  const selectSession = useCallback((sessionId: string) => openSession(sessionId), []);

  // Root -> expanded children state (UI-only)
  const [expandedRoots, setExpandedRoots] = useState<Set<string>>(new Set());

  // Pre-compute pinned-child root IDs from allChildrenByRoot to avoid scanning
  // the entire chats array on every render inside expandedRootIds.
  const pinnedChildRootIds = useMemo(() => {
    if (sidebarCollapsed) return emptySet;
    const ids = new Set<string>();
    for (const children of Object.values(allChildrenByRoot)) {
      for (const c of children) {
        if (c.pinned) {
          const rootId = c.parentSessionId || c.rootSessionId;
          if (rootId) ids.add(rootId);
        }
      }
    }
    return ids;
  }, [allChildrenByRoot, sidebarCollapsed, emptySet]);

  const expandedRootIds = useMemo(() => {
    if (sidebarCollapsed) return emptySet;

    const next = new Set(expandedRoots);

    // Ensure a selected child is visible, but do not automatically expand every
    // selected root's children — that creates too much persistent sidebar noise.
    if (selectedSessionMeta?.kind === "child") {
      const rootId = selectedSessionMeta.parentSessionId || selectedSessionMeta.rootSessionId;
      if (rootId) next.add(rootId);
    }

    // Pinned child implies its root should stay expanded (pin == "keep visible").
    for (const rootId of pinnedChildRootIds) {
      next.add(rootId);
    }

    if (hasActiveFilters) {
      for (const rootChat of filteredRootSessions) {
        if ((childrenByRoot[rootChat.id]?.length ?? 0) > 0) {
          next.add(rootChat.id);
        }
      }
    }

    return next;
  }, [
    childrenByRoot,
    expandedRoots,
    filteredRootSessions,
    hasActiveFilters,
    pinnedChildRootIds,
    selectedSessionMeta,
    sidebarCollapsed,
    emptySet,
  ]);

  const toggleRootExpanded = useCallback((rootId: string) => {
    setExpandedRoots((prev) => {
      const next = new Set(prev);
      if (next.has(rootId)) next.delete(rootId);
      else next.add(rootId);
      return next;
    });
  }, []);

  return {
    chats: filteredRootSessions,
    childrenByRoot,
    expandedRootIds,
    toggleRootExpanded,
    collapsed: sidebarCollapsed,
    currentSessionId,
    expandedKeys,
    groupedChatsByDate,
    hasActiveFilters,
    handleCollapseChange,
    handleDelete,
    handleDeleteByDate,
    handleEditTitle,
    handleGenerateTitle,
    handleNewChat,
    handleNewChatSelectorClose,
    handleOpenSettings,
    handleRunProjectDream,
    handleSearchQueryChange,
    handleStatusFilterChange,
    handleClearFilters,
    handleSystemPromptSelect,
    isNewChatSelectorOpen,
    pinSession: handlePinChat,
    projectDreamState,
    searchQuery,
    selectSession,
    setCollapsed: setSidebarCollapsed,
    sortedDateKeys,
    statusFilter,
    systemPrompts,
    titleGenerationState: {} as Record<
      string,
      { status: "loading" | "error" | "idle"; error?: string }
    >,
    unpinSession: handleUnpinChat,
  };
};
