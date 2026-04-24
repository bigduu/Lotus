import { useCallback, useMemo, useState } from "react";
import { App as AntdApp, Modal } from "antd";
import { useTranslation } from "react-i18next";

import { AgentClient } from "@services/chat/AgentService";

import {
  getChatCountByDate,
  getSessionIdsByDate,
  getDateGroupKeyForChat,
  getSortedDateKeys,
  groupChatsByDate,
} from "../../utils/chatUtils";
import { useSettingsViewStore } from "../../../../shared/store/settingsViewStore";
import { useChatTitleGeneration } from "../../hooks/useChatManager/useChatTitleGeneration";
import { selectSessionById, useAppStore } from "../../store";
import type { ChatItem, UserSystemPrompt } from "../../types/chat";
import { useUILayoutStore } from "@shared/store/uiLayoutStore";
import { useProviderStore } from "../../store/slices/providerSlice";
import { openSession } from "../../utils/openSession";

type SidebarStatusFilter = "all" | "pinned" | "running" | "child";

const matchesSearchQuery = (chat: ChatItem, normalizedQuery: string): boolean => {
  if (!normalizedQuery) return true;

  const haystack = [
    chat.title,
    chat.id,
    chat.kind || "root",
    chat.config.workspacePath || "",
    chat.config.systemPromptId || "",
    chat.updatedAt || "",
    chat.createdByScheduleId || "",
    chat.lastRunStatus || "",
    chat.lastRunError || "",
    // Include first user message content for lightweight content search
    ...chat.messages
      .filter((m) => m.role === "user" && "content" in m)
      .slice(0, 3)
      .map((m) => ("content" in m ? (m as { content: string }).content : "")),
  ]
    .join(" ")
    .toLowerCase();

  // Support multi-word search: all terms must match
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  return terms.every((term) => haystack.includes(term));
};

const matchesStatusFilter = (chat: ChatItem, filter: SidebarStatusFilter): boolean => {
  switch (filter) {
    case "pinned":
      return Boolean(chat.pinned);
    case "running":
      return Boolean(chat.isRunning);
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
  const chats = useAppStore((state) => state.chats);
  const currentSessionId = useAppStore((state) => state.currentSessionId);
  const deleteSession = useAppStore((state) => state.deleteSession);
  const deleteSessions = useAppStore((state) => state.deleteSessions);
  const pinSession = useAppStore((state) => state.pinSession);
  const unpinSession = useAppStore((state) => state.unpinSession);
  const updateSession = useAppStore((state) => state.updateSession);
  const addChat = useAppStore((state) => state.addChat);
  const refreshChats = useAppStore((state) => state.refreshChats);
  const lastSelectedPromptId = useAppStore((state) => state.lastSelectedPromptId);
  const systemPrompts = useAppStore((state) => state.systemPrompts);

  const sidebarCollapsed = useUILayoutStore((s) => s.sidebar.collapsed);
  const setSidebarCollapsed = useUILayoutStore((s) => s.setSidebarCollapsed);
  const clearSessionFromAllLeaves = useUILayoutStore((s) => s.clearSessionFromAllLeaves);

  const { generateChatTitle, titleGenerationState } = useChatTitleGeneration({
    chats,
    updateSession,
  });

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
          ...(useProviderStore.getState().isProviderModelRefEnabled()
            ? { model_ref: useProviderStore.getState().selectedModelRef }
            : {}),
        },
        currentInteraction: null,
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

  const currentChat = useAppStore(selectSessionById(currentSessionId));

  const currentDateGroupKey = useMemo(() => {
    return currentChat ? getDateGroupKeyForChat(currentChat) : null;
  }, [currentChat]);

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

  // Folder model: sidebar groups only root sessions by date.
  // Child sessions are rendered nested under their root.
  const rootSessions = useMemo(() => chats.filter((c) => c.kind !== "child"), [chats]);

  const allChildrenByRoot = useMemo(() => {
    const map: Record<string, ChatItem[]> = {};
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
  }, [chats]);

  const filteredRootSessions = useMemo(() => {
    if (!hasActiveFilters) return rootSessions;

    return rootSessions.filter((rootChat) => {
      const rootMatches =
        matchesSearchQuery(rootChat, normalizedSearchQuery) &&
        matchesStatusFilter(rootChat, statusFilter);
      if (rootMatches) return true;

      const childSessions = allChildrenByRoot[rootChat.id] || [];
      return childSessions.some(
        (childChat) =>
          matchesSearchQuery(childChat, normalizedSearchQuery) &&
          matchesStatusFilter(childChat, statusFilter),
      );
    });
  }, [allChildrenByRoot, hasActiveFilters, normalizedSearchQuery, rootSessions, statusFilter]);

  const childrenByRoot = useMemo(() => {
    if (!hasActiveFilters) {
      return allChildrenByRoot;
    }

    const map: Record<string, ChatItem[]> = {};
    for (const rootChat of filteredRootSessions) {
      const childSessions = allChildrenByRoot[rootChat.id] || [];
      map[rootChat.id] = childSessions.filter(
        (childChat) =>
          matchesSearchQuery(childChat, normalizedSearchQuery) &&
          matchesStatusFilter(childChat, statusFilter),
      );
    }

    return map;
  }, [
    allChildrenByRoot,
    filteredRootSessions,
    hasActiveFilters,
    normalizedSearchQuery,
    statusFilter,
  ]);

  const groupedChatsByDate = groupChatsByDate(filteredRootSessions);
  const sortedDateKeys = getSortedDateKeys(groupedChatsByDate);

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

  const handleEditTitle = (sessionId: string, newTitle: string) => {
    updateSession(sessionId, { title: newTitle });
  };

  const handleGenerateTitle = async (sessionId: string) => {
    try {
      await generateChatTitle(sessionId, { force: true });
    } catch (error) {
      console.error("Failed to generate title:", error);
    }
  };

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

  const expandedRootIds = useMemo(() => {
    const next = new Set(expandedRoots);

    // Ensure current selection is visible.
    const current = chats.find((c) => c.id === currentSessionId);
    if (current) {
      const rootId =
        current.kind === "child" ? current.parentSessionId || current.rootSessionId : current.id;
      if (rootId) next.add(rootId);
    }

    // Pinned child implies its root should stay expanded (pin == "keep visible").
    for (const c of chats) {
      if (c.kind === "child" && c.pinned) {
        const rootId = c.parentSessionId || c.rootSessionId;
        if (rootId) next.add(rootId);
      }
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
    chats,
    childrenByRoot,
    currentSessionId,
    expandedRoots,
    filteredRootSessions,
    hasActiveFilters,
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
    titleGenerationState,
    unpinSession: handleUnpinChat,
  };
};
