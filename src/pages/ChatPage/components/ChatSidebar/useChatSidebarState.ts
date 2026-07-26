import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App as AntdApp, Modal } from "antd";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";

import { AgentClient } from "@services/chat/AgentService";

import {
  getChatCountByDate,
  getSessionIdsByDate,
  getSortedProjectKeys,
  groupChatsByCalendarDate,
  groupChatsByProject,
} from "../../utils/chatUtils";
import { NO_PROJECT_GROUP_KEY } from "@services/project";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useSettingsViewStore } from "@shared/store/settingsViewStore";
import { useAppStore } from "@shared/store/appStore";
import type { ChatItem, UserSystemPrompt } from "@shared/types/chat";
import type { SidebarChatItem, SidebarScrollTarget } from "@shared/types/sidebarChat";
import { useUILayoutStore } from "@shared/store/uiLayoutStore";
import type { SidebarGroupingMode } from "@shared/store/uiLayoutStore.types";
import { openSession } from "@shared/utils/openSession";
import { selectIsBusy, selectSidebarRunStateMap } from "@shared/store/appStore";

type SidebarStatusFilter = "all" | "pinned" | "running" | "child";

// Search filtering (matchesSearchQuery) can fall back to scanning message
// content from the live store, which is expensive when it runs on every
// keystroke. Debounce the *filtering*, not the input value itself, so the
// text field stays instantly responsive.
const SEARCH_FILTER_DEBOUNCE_MS = 200;
const WORKSPACE_EXPANSION_STORAGE_KEY = "lotus.sidebar.workspace.expanded.v1";
const PROJECT_EXPANSION_STORAGE_KEY = "lotus.sidebar.project.expanded.v1";

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
    projectId: chat.config.projectId || null,
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
  prev.config.workspacePath === (chat.config.workspacePath || null) &&
  prev.config.projectId === (chat.config.projectId || null);

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

  const {
    sidebarCollapsed,
    setSidebarCollapsed,
    clearSessionFromAllLeaves,
    storedGroupingMode,
    setGroupingMode,
  } = useUILayoutStore(
    useShallow((s) => ({
      sidebarCollapsed: s.sidebar.collapsed,
      setSidebarCollapsed: s.setSidebarCollapsed,
      clearSessionFromAllLeaves: s.clearSessionFromAllLeaves,
      // Lotus #95 — secondary "group by workspace" sidebar mode, persisted
      // the same way `sidebar.collapsed` already is.
      storedGroupingMode: s.sidebar.groupingMode,
      setGroupingMode: s.setSidebarGroupingMode,
    })),
  );
  const groupingMode: SidebarGroupingMode = "project";

  // Lotus #134 — the sidebar hierarchy is Project-first (Project → Date →
  // root/child session). Migrate the former date/workspace preference once
  // and keep the persisted value canonical.
  useEffect(() => {
    if (storedGroupingMode !== "project") setGroupingMode("project");
  }, [storedGroupingMode, setGroupingMode]);

  // Project metadata is ID-normalized in the app store; the sidebar joins
  // session `projectId`s against it for group labels/archived status.
  const { projects, loadProjects, ensureProject } = useAppStore(
    useShallow((state) => ({
      projects: state.projects,
      loadProjects: state.loadProjects,
      ensureProject: state.ensureProject,
    })),
  );

  useEffect(() => {
    loadProjects().catch((error) => {
      console.warn("[ChatSidebar] Failed to load projects:", error);
    });
  }, [loadProjects]);

  // Sessions can reference Projects that have not been loaded into the local
  // map yet (e.g. created on another device). Fetch those lazily so the
  // sidebar can show real names instead of the "Missing project" fallback.
  useEffect(() => {
    const known = useAppStore.getState().projects;
    const missing = new Set<string>();
    for (const chat of chats) {
      const projectId = chat.config.projectId;
      if (projectId && !known[projectId]) missing.add(projectId);
    }
    for (const projectId of missing) {
      ensureProject(projectId).catch(() => {
        // 404s are handled inside ensureProject (drops the record); other
        // failures leave the "Missing project" label in place.
      });
    }
  }, [chats, ensureProject]);

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
  const [scheduleThisSessionId, setScheduleThisSessionId] = useState<string | null>(null);
  // Lotus #134 — Project expansion is keyed by stable `project_id`, so a
  // Project rename or a session's workspace switch never loses expansion
  // state. The old workspace-path keys cannot be mapped to project ids
  // reliably, so they are discarded (never used to fabricate Projects).
  const [expandedProjectGroups, setExpandedProjectGroups] = useState<Set<string>>(() => {
    try {
      localStorage.removeItem(WORKSPACE_EXPANSION_STORAGE_KEY);
      localStorage.removeItem("lotus.sidebar.workspace-date.collapsed.v1");
      const value = JSON.parse(localStorage.getItem(PROJECT_EXPANSION_STORAGE_KEY) || "[]");
      return new Set(Array.isArray(value) ? value.filter((item) => typeof item === "string") : []);
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(
        PROJECT_EXPANSION_STORAGE_KEY,
        JSON.stringify([...expandedProjectGroups]),
      );
    } catch {}
  }, [expandedProjectGroups]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<SidebarStatusFilter>("all");
  const [projectDreamState, setProjectDreamState] = useState<
    Record<string, { status: "loading" | "idle" }>
  >({});
  const [titleGenerationState, setTitleGenerationState] = useState<
    Record<string, { status: "loading" | "error" | "idle"; error?: string }>
  >({});

  const selectedSessionMeta = useAppStore(
    useShallow((state) => {
      const sessionId = state.currentSessionId;
      if (!sessionId) return null;

      const chat = state.chats.find((item) => item.id === sessionId);
      if (!chat) return null;
      const root =
        chat.kind === "child"
          ? state.chats.find((item) => item.id === (chat.rootSessionId || chat.parentSessionId))
          : chat;

      return {
        id: chat.id,
        kind: chat.kind,
        parentSessionId: chat.parentSessionId || null,
        rootSessionId: chat.rootSessionId || null,
        pinned: Boolean(root?.pinned ?? chat.pinned),
        createdAt: root?.createdAt ?? chat.createdAt,
        createdByScheduleId: root?.createdByScheduleId || null,
        workspacePath: root?.config.workspacePath || chat.config.workspacePath || null,
        projectId: root?.config.projectId || chat.config.projectId || null,
      };
    }),
  );

  // Project mode (#134): the selected session's stable Project key, so its
  // group auto-expands. Unassigned sessions resolve to the fixed sentinel.
  const currentProjectGroupKey = useMemo(() => {
    if (!selectedSessionMeta) return null;
    return selectedSessionMeta.projectId?.trim() || NO_PROJECT_GROUP_KEY;
  }, [selectedSessionMeta]);

  // Debounce the expensive filter recomputation, not the input value: the
  // <Input> stays bound to `searchQuery` directly so typed characters echo
  // immediately, while the useMemo chain below only re-filters after the
  // user pauses. Clearing the box (value === "") bypasses the debounce so
  // the list resets promptly instead of showing stale filtered results for
  // one more debounce interval — this also avoids a rapid type-then-clear
  // briefly re-applying a stale query once the pending timer fires.
  const debouncedSearchQuery = useDebouncedValue(searchQuery, SEARCH_FILTER_DEBOUNCE_MS);
  const effectiveSearchQuery = searchQuery === "" ? "" : debouncedSearchQuery;
  const normalizedSearchQuery = effectiveSearchQuery.trim().toLowerCase();
  const hasActiveFilters = normalizedSearchQuery.length > 0 || statusFilter !== "all";

  // ─── Filter-aware group expansion (#61, extended to status filters in
  // #67, generalized to the workspace grouping mode in #95) ──────────────
  // A filter match inside a collapsed, non-selected group used to stay
  // invisible: the baseline expand set (`expandedDates` or, in workspace
  // mode, `expandedWorkspaceGroups`) only ever grew via explicit user
  // clicks (plus the always-expanded selected-session group). While ANY
  // filter is active — a search query, a status filter (pinned/running/
  // child), or both — we instead auto-expand every group that currently
  // contains a match — that's exactly `activeSortedGroupKeys` below, since
  // `activeGroupedChats` is built from `filteredRootSessions`, which
  // already excludes non-matching roots/children under both the search and
  // status predicates.
  //
  // The user can still manually collapse a group while a filter is active;
  // to avoid fighting them on every keystroke or filter toggle, this
  // override is re-derived (reset) only when the *filter episode* changes —
  // i.e. when the effective (debounced) search query, the status filter, or
  // the grouping mode itself changes — not on unrelated re-renders. The
  // baseline expand set is left untouched by filtering, so once every
  // filter clears, expansion reverts to whatever the user had before
  // filtering.
  const [searchCollapseOverrides, setSearchCollapseOverrides] = useState<Set<string>>(
    () => new Set(),
  );
  // Separated with an escape sequence that cannot occur in either input:
  // `statusFilter` is a closed enum, and search text can never contain a
  // raw NUL, so this cannot collide between two distinct (query, filter)
  // pairs the way a plain string join could.
  // `groupingMode` is folded in too (#95) — switching grouping mode swaps
  // the entire key-space (date keys like "Today" vs workspace paths), so a
  // mid-filter manual collapse override recorded under one mode must not
  // leak into the other.
  const filterEpisodeKey = `${effectiveSearchQuery}\u0000${statusFilter}\u0000${groupingMode}`;
  const [lastFilterEpisodeKey, setLastFilterEpisodeKey] = useState(filterEpisodeKey);
  if (filterEpisodeKey !== lastFilterEpisodeKey) {
    setLastFilterEpisodeKey(filterEpisodeKey);
    setSearchCollapseOverrides(new Set());
  }

  // ─── Heavy derived data (gated by collapsed state) ─────────────────
  // When the sidebar is collapsed, we return empty / cheap placeholders
  // so that re-renders caused by store updates don't recompute grouping,
  // filtering, or date-sorting work that nobody will see.
  const emptyChatArr = useMemo<SidebarChatItem[]>(() => [], []);
  const emptyChildrenMap = useMemo<Record<string, SidebarChatItem[]>>(() => ({}), []);
  const emptyGrouped = useMemo<Record<string, SidebarChatItem[]>>(() => ({}), []);
  const emptyStrArr = useMemo<string[]>(() => [], []);
  const emptySet = useMemo<Set<string>>(() => new Set(), []);
  const emptyBoolMap = useMemo<Record<string, boolean>>(() => ({}), []);
  const emptyLabelMap = useMemo<Record<string, string>>(() => ({}), []);

  // Folder model: sidebar groups only root sessions by date (or, in
  // workspace mode, by `config.workspacePath` — #95).
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
      const rootId = c.rootSessionId || c.parentSessionId;
      if (!rootId) continue;
      if (!map[rootId]) map[rootId] = [];
      map[rootId].push(c);
    }
    Object.keys(map).forEach((rootId) => {
      map[rootId].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        // Sort by creation time (stable) instead of updatedAt which changes
        // on every content update and causes constant reshuffling.
        return (b.createdAt ?? 0) - (a.createdAt ?? 0);
      });
    });
    return map;
  }, [chats, sidebarCollapsed, emptyChildrenMap]);

  // ─── Live per-item status indicator (#94) ──────────────────────────
  // A single `useShallow`-wrapped selector over the whole
  // `executionBySession` map, covering every session id currently in the
  // sidebar (root + child) — NOT a per-`ChatItem` store subscription. The
  // returned map only ever holds primitive values, so an execution-state
  // mutation that doesn't actually change any covered session's derived
  // status (e.g. a streaming token for an already-"running" session)
  // produces a referentially stable result and this hook's callers don't
  // re-render at all. See #18/#3/#68/#74 for the render-scoping precedent
  // this deliberately follows.
  const allSessionIds = useMemo(
    () => (sidebarCollapsed ? emptyStrArr : chats.map((c) => c.id)),
    [chats, sidebarCollapsed, emptyStrArr],
  );
  const runStateBySessionId = useAppStore(useShallow(selectSidebarRunStateMap(allSessionIds)));

  // Roots with a running/awaiting child should reflect it even while
  // collapsed (children are hidden by default) — derived from the same
  // narrow `runStateBySessionId` map plus the already-computed child list,
  // so it costs one extra O(#children) pass only when either input actually
  // changes, never a new subscription.
  const rootHasRunningChildBySessionId = useMemo(() => {
    if (sidebarCollapsed) return emptyBoolMap;
    const result: Record<string, boolean> = {};
    for (const [rootId, children] of Object.entries(allChildrenByRoot)) {
      const hasActiveChild = children.some((child) => {
        const state = runStateBySessionId[child.id];
        return state === "running" || state === "awaiting";
      });
      if (hasActiveChild) {
        result[rootId] = true;
      }
    }
    return result;
  }, [allChildrenByRoot, runStateBySessionId, sidebarCollapsed, emptyBoolMap]);

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

  // ─── Top-level grouping: by Project (#134) ─────────────────────────
  // Same `filteredRootSessions` input and Record<string, T[]> shape as the
  // other pipelines. Group keys are stable backend `project_id`s (or the
  // `NO_PROJECT_GROUP_KEY` sentinel) — a workspace switch never moves a
  // session to another group.
  const groupedChatsByProject = useMemo(
    () => (sidebarCollapsed ? emptyGrouped : groupChatsByProject(filteredRootSessions)),
    [filteredRootSessions, sidebarCollapsed, emptyGrouped],
  );
  // Archived Projects sink below active ones; Unassigned stays last
  // (getSortedProjectKeys).
  const archivedProjectKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const project of Object.values(projects)) {
      if (project.status === "archived") keys.add(project.id);
    }
    return keys;
  }, [projects]);
  const sortedProjectKeys = useMemo(
    () =>
      sidebarCollapsed
        ? emptyStrArr
        : getSortedProjectKeys(groupedChatsByProject, archivedProjectKeys),
    [groupedChatsByProject, archivedProjectKeys, sidebarCollapsed, emptyStrArr],
  );
  // Display label per Project group key, joined from the ID-normalized
  // Project store. A session referencing a Project that is deleted or not
  // visible gets an explicit "Missing project" label instead of silently
  // falling back to workspace grouping.
  const projectGroupLabels = useMemo(() => {
    if (sidebarCollapsed) return emptyLabelMap;
    const labels: Record<string, string> = {};
    for (const key of Object.keys(groupedChatsByProject)) {
      if (key === NO_PROJECT_GROUP_KEY) continue;
      labels[key] = projects[key]?.name ?? t("chat.sidebar.missingProject", "Missing project");
    }
    return labels;
  }, [groupedChatsByProject, projects, sidebarCollapsed, emptyLabelMap, t]);

  // The grouping actually rendered (#134 — the sidebar hierarchy is
  // Project-first). Plain (unmemoized) picks: cheap reference selection.
  const activeGroupedChats = groupedChatsByProject;
  const activeSortedGroupKeys = sortedProjectKeys;
  const currentGroupKey = currentProjectGroupKey;

  // ─── Scroll-to-active-session target (#93) ─────────────────────────
  // Resolves which date group + row the currently active session lives in,
  // so ChatSidebarDateGroups can bring it into view (scrollToIndex for a
  // virtualized group, scrollIntoView otherwise). This is intentionally an
  // effect keyed ONLY on `currentSessionId`, not a `useMemo` derived from
  // the (frequently-changing-while-filtering) grouped/children data: a
  // plain memo would recompute — and therefore instruct a re-scroll — on
  // every filter keystroke even though the active session never moved.
  // Reading the grouped/children data through refs (updated every render,
  // but NOT part of the effect's dependency array) gives the effect the
  // freshest data available at the moment it actually needs to run, without
  // making filter-driven churn a trigger in its own right. Mount is covered
  // for free: an effect always runs once on mount regardless of whether its
  // dependency "changed" from anything.
  const activeGroupedChatsRef = useRef(activeGroupedChats);
  activeGroupedChatsRef.current = activeGroupedChats;
  const activeSortedGroupKeysRef = useRef(activeSortedGroupKeys);
  activeSortedGroupKeysRef.current = activeSortedGroupKeys;
  const childrenByRootRef = useRef(childrenByRoot);
  childrenByRootRef.current = childrenByRoot;

  const [scrollTarget, setScrollTarget] = useState<SidebarScrollTarget>(null);

  useEffect(() => {
    if (!currentSessionId) {
      setScrollTarget(null);
      return;
    }

    const grouped = activeGroupedChatsRef.current;
    const childrenMap = childrenByRootRef.current;

    for (const dateKey of activeSortedGroupKeysRef.current) {
      const group = grouped[dateKey] || [];
      const rootMatch = group.find((chat) => chat.id === currentSessionId);
      if (rootMatch) {
        const nestedDateKey = Object.entries(groupChatsByCalendarDate(group)).find(([, items]) =>
          items.some((item) => item.id === rootMatch.id),
        )?.[0];
        setScrollTarget({ dateKey, nestedDateKey, rootId: rootMatch.id, childId: null });
        return;
      }

      for (const rootChat of group) {
        const childMatch = (childrenMap[rootChat.id] || []).find(
          (chat) => chat.id === currentSessionId,
        );
        if (childMatch) {
          const nestedDateKey = Object.entries(groupChatsByCalendarDate(group)).find(([, items]) =>
            items.some((item) => item.id === rootChat.id),
          )?.[0];
          setScrollTarget({
            dateKey,
            nestedDateKey,
            rootId: rootChat.id,
            childId: childMatch.id,
          });
          return;
        }
      }
    }

    // Not found — either filtered out or not yet loaded. Do nothing: no
    // stale target lingers to fire a scroll once the row later reappears
    // (that would happen for a reason unrelated to the session actually
    // changing, e.g. clearing a search query).
    setScrollTarget(null);
    // `groupingMode` is included so switching modes re-resolves the target
    // against the newly-active grouping's key-space (#95) — otherwise a
    // stale `dateKey` from the other mode's key-space would linger.
  }, [currentSessionId, groupingMode]);

  // While any filter (search query and/or status) is active, expand every
  // group that currently contains a match (all of `activeSortedGroupKeys`,
  // minus any the user explicitly collapsed during this filter episode —
  // see `searchCollapseOverrides` above). Otherwise fall back to the user's
  // baseline expansion for whichever grouping mode is active (#95), always
  // keeping the currently selected chat's group open, without causing an
  // effect-driven setState loop.
  const expandedKeys = useMemo(() => {
    if (hasActiveFilters) {
      return activeSortedGroupKeys.filter((key) => !searchCollapseOverrides.has(key));
    }

    const next = new Set(expandedProjectGroups);
    if (currentGroupKey) {
      next.add(currentGroupKey);
    }
    return Array.from(next);
  }, [
    activeSortedGroupKeys,
    currentGroupKey,
    expandedProjectGroups,
    hasActiveFilters,
    searchCollapseOverrides,
  ]);

  const handleCollapseChange = (keys: string | string[]) => {
    const next = new Set(Array.isArray(keys) ? keys : [keys]);

    if (hasActiveFilters) {
      // Every group rendered while a filter is active is already
      // auto-expanded (it's a member of `activeSortedGroupKeys`); track
      // which of those the user explicitly collapsed rather than touching
      // the baseline set, so a manual collapse mid-filter never leaks into
      // the state restored once every filter clears.
      setSearchCollapseOverrides((prev) => {
        let changed = false;
        const nextOverrides = new Set(prev);
        for (const key of activeSortedGroupKeys) {
          const shouldBeCollapsed = !next.has(key);
          if (shouldBeCollapsed && !nextOverrides.has(key)) {
            nextOverrides.add(key);
            changed = true;
          } else if (!shouldBeCollapsed && nextOverrides.has(key)) {
            nextOverrides.delete(key);
            changed = true;
          }
        }
        return changed ? nextOverrides : prev;
      });
      return;
    }

    setExpandedProjectGroups((prev) => {
      if (prev.size !== next.size) return next;
      for (const k of next) {
        if (!prev.has(k)) return next;
      }
      return prev;
    });
  };

  const handlePinChat = useCallback(
    (sessionId: string) => {
      pinSession(sessionId);
    },
    [pinSession],
  );

  const handleUnpinChat = useCallback(
    (sessionId: string) => {
      unpinSession(sessionId);
    },
    [unpinSession],
  );

  const handleDelete = (sessionId: string) => {
    Modal.confirm({
      title: t("chat.sidebar.delete.title"),
      content: t("chat.sidebar.delete.confirm"),
      okText: t("common.delete"),
      okType: "danger",
      cancelText: t("common.cancel"),
      onOk: async () => {
        try {
          await deleteSession(sessionId);
          clearSessionFromAllLeaves(sessionId);
        } catch (error) {
          // The backend delete failed — local state was left untouched
          // (#163), so the session is still here; tell the user instead of
          // pretending it was deleted. Technical details go to the console.
          console.error("[ChatSidebar] Failed to delete session:", error);
          message.error(t("chat.sidebar.deleteFailed"));
        }
      },
    });
  };

  const openSettings = useSettingsViewStore((state) => state.open);

  const handleOpenSettings = () => {
    openSettings("chat");
  };

  // Lotus #99: a one-click entry into the (otherwise Settings-buried)
  // schedules feature, mirroring the footer's existing Settings/Agenda
  // buttons — deep-links straight into the Schedules tab rather than
  // requiring the user to first open Settings and then find the tab.
  const handleOpenSchedules = () => {
    openSettings("chat", "schedules");
  };

  // Lotus #100: "Schedule this" opens a session-prefilled create-schedule
  // modal from the sidebar item menu.
  const handleScheduleThis = useCallback((sessionId: string) => {
    setScheduleThisSessionId(sessionId);
  }, []);

  const handleCloseScheduleThis = useCallback(() => {
    setScheduleThisSessionId(null);
  }, []);

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

  const handleGenerateTitle = useCallback(
    async (sessionId: string) => {
      if (titleGenerationState[sessionId]?.status === "loading") {
        return;
      }

      setTitleGenerationState((prev) => ({
        ...prev,
        [sessionId]: { status: "loading" },
      }));

      const hide = message.loading(t("chat.actions.generateTitleRunning"), 0);
      try {
        await AgentClient.getInstance().regenerateSessionTitle(sessionId);
        hide();
        message.success(t("chat.actions.generateTitleSuccess"));

        try {
          await refreshChats();
        } catch (refreshError) {
          console.warn("Failed to refresh chats after title regeneration:", refreshError);
        }

        setTitleGenerationState((prev) => ({
          ...prev,
          [sessionId]: { status: "idle" },
        }));
      } catch (error) {
        hide();
        const errorMessage =
          error instanceof Error && error.message
            ? error.message
            : t("chat.actions.generateTitleFailed");
        message.error(errorMessage);
        console.error("Failed to regenerate session title:", error);

        setTitleGenerationState((prev) => ({
          ...prev,
          [sessionId]: { status: "error", error: errorMessage },
        }));
      }
    },
    [message, refreshChats, t, titleGenerationState],
  );

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

  // Handles "delete all sessions in this Project group" (#134) — resolves
  // session ids from the currently-rendered group, clears them from panes,
  // and bulk-deletes.
  const handleDeleteByGroup = (groupKey: string) => {
    const sessionIds = getSessionIdsByDate(activeGroupedChats, groupKey);
    const chatCount = getChatCountByDate(activeGroupedChats, groupKey);

    const projectLabel =
      groupKey === NO_PROJECT_GROUP_KEY
        ? t("chat.sidebar.unassigned", "Unassigned")
        : (projectGroupLabels[groupKey] ?? groupKey);

    Modal.confirm({
      title: t("chat.sidebar.deleteByProject.title", { project: projectLabel }),
      content: t("chat.sidebar.deleteByProject.confirm", {
        count: chatCount,
        project: projectLabel,
      }),
      okText: t("common.delete"),
      okType: "danger",
      cancelText: t("common.cancel"),
      onOk: async () => {
        const { failedIds } = await deleteSessions(sessionIds);
        const succeededIds = sessionIds.filter((id) => !failedIds.includes(id));
        succeededIds.forEach((id) => clearSessionFromAllLeaves(id));
        if (failedIds.length > 0) {
          message.warning(t("chat.sidebar.deleteSomeFailed", { count: failedIds.length }));
        }
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
          const rootId = c.rootSessionId || c.parentSessionId;
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
      const rootId = selectedSessionMeta.rootSessionId || selectedSessionMeta.parentSessionId;
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
    // `activeGroupedChats`/`activeSortedGroupKeys` are the Project-first
    // grouping (#134) the presentation layer renders.
    activeGroupedChats,
    activeSortedGroupKeys,
    groupingMode,
    setGroupingMode,
    projectGroupLabels,
    archivedProjectKeys,
    hasActiveFilters,
    handleCollapseChange,
    handleDelete,
    handleDeleteByDate: handleDeleteByGroup,
    handleEditTitle,
    handleGenerateTitle,
    handleNewChat,
    handleNewChatSelectorClose,
    handleOpenSettings,
    handleOpenSchedules,
    handleRunProjectDream,
    handleScheduleThis,
    handleCloseScheduleThis,
    handleSearchQueryChange,
    handleStatusFilterChange,
    handleClearFilters,
    handleSystemPromptSelect,
    isNewChatSelectorOpen,
    pinSession: handlePinChat,
    projectDreamState,
    rootHasRunningChildBySessionId,
    runStateBySessionId,
    scheduleThisSessionId,
    scrollTarget,
    searchQuery,
    selectSession,
    setCollapsed: setSidebarCollapsed,
    statusFilter,
    systemPrompts,
    titleGenerationState,
    unpinSession: handleUnpinChat,
  };
};
