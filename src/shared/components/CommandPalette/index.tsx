import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { App as AntdApp, Input, Modal, Tag, Typography, theme } from "antd";
import type { InputRef } from "antd";
import {
  AppstoreOutlined,
  BgColorsOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  ExperimentOutlined,
  LayoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MessageOutlined,
  PlusOutlined,
  SearchOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";

import { getActiveLocaleTag } from "@shared/i18n/dateFnsLocale";
import { useAppStore } from "@shared/store/appStore";
import { isBusyPhase } from "@shared/store/appStore/slices/executionStateSlice";
import { openSession } from "@shared/utils/openSession";
import { useSettingsViewStore, type SettingsTabKey } from "@shared/store/settingsViewStore";
import { useLedgerViewStore } from "@shared/store/ledgerViewStore";
import { useUILayoutStore, getLeafIdsFromTree } from "@shared/store/uiLayoutStore";
import { useThemeStore } from "@shared/store/themeStore";
import {
  useExperienceModeStore,
  ADVANCED_ONLY_SETTINGS_TABS,
} from "@shared/store/experienceModeStore";
import type { ChatItem } from "@shared/types/chatMessages";

import "./index.css";

type CommandPaletteAction = {
  id: string;
  kind: "action" | "session";
  title: string;
  subtitle?: string;
  keywords: string[];
  icon: React.ReactNode;
  badge?: string;
  onSelect: () => Promise<void> | void;
};

type CommandPaletteSession = {
  id: string;
  title: string;
  kind: ChatItem["kind"];
  pinned?: boolean;
  updatedAt?: string;
  workspacePath?: string;
};

const projectCommandPaletteSessions = (() => {
  let prevSource: ReadonlyArray<ChatItem> | null = null;
  let prevProjected: CommandPaletteSession[] = [];
  let prevById = new Map<string, CommandPaletteSession>();

  return (source: ReadonlyArray<ChatItem>): CommandPaletteSession[] => {
    if (source === prevSource) {
      return prevProjected;
    }

    const next = source.map((chat) => {
      const previous = prevById.get(chat.id);
      const nextProjected: CommandPaletteSession = {
        id: chat.id,
        title: chat.title,
        kind: chat.kind,
        pinned: chat.pinned,
        updatedAt: chat.updatedAt,
        workspacePath: chat.config.workspacePath,
      };
      if (
        previous &&
        previous.title === nextProjected.title &&
        previous.kind === nextProjected.kind &&
        previous.pinned === nextProjected.pinned &&
        previous.updatedAt === nextProjected.updatedAt &&
        previous.workspacePath === nextProjected.workspacePath
      ) {
        return previous;
      }
      return nextProjected;
    });

    const unchanged =
      next.length === prevProjected.length &&
      next.every((item, index) => item === prevProjected[index]);

    prevSource = source;
    prevById = new Map(next.map((item) => [item.id, item]));
    if (unchanged) {
      return prevProjected;
    }
    prevProjected = next;
    return next;
  };
})();

const SETTINGS_ACTIONS: Array<{
  id: string;
  tabKey: SettingsTabKey;
  titleKey: string;
  fallbackTitle: string;
  subtitleKey?: string;
  fallbackSubtitle?: string;
  badge?: string;
  keywords?: string[];
}> = [
  {
    id: "settings-provider",
    tabKey: "provider",
    titleKey: "commandPalette.actions.openProviderSettings",
    fallbackTitle: "Open Provider Settings",
    subtitleKey: "commandPalette.groups.settings",
    fallbackSubtitle: "System settings",
    badge: "AI",
    keywords: ["api", "key", "openai", "anthropic", "gemini", "model"],
  },
  {
    id: "settings-model-limits",
    tabKey: "model-limits",
    titleKey: "commandPalette.actions.openModelLimits",
    fallbackTitle: "Open Model Limits",
    subtitleKey: "commandPalette.groups.settings",
    fallbackSubtitle: "System settings",
    badge: "AI",
    keywords: ["token", "context", "window", "budget", "limit"],
  },
  {
    id: "settings-prompts",
    tabKey: "prompts",
    titleKey: "commandPalette.actions.openPrompts",
    fallbackTitle: "Open System Prompts",
    subtitleKey: "commandPalette.groups.settings",
    fallbackSubtitle: "System settings",
    badge: "AI",
    keywords: ["system", "prompt", "persona", "instruction"],
  },
  {
    id: "settings-skills",
    tabKey: "skills",
    titleKey: "commandPalette.actions.openSkills",
    fallbackTitle: "Open Skills",
    subtitleKey: "commandPalette.groups.settings",
    fallbackSubtitle: "System settings",
    badge: "Tools",
    keywords: ["skill", "capability", "plugin"],
  },
  {
    id: "settings-mcp",
    tabKey: "mcp",
    titleKey: "commandPalette.actions.openMcpSettings",
    fallbackTitle: "Open MCP Settings",
    subtitleKey: "commandPalette.groups.settings",
    fallbackSubtitle: "System settings",
    badge: "Tools",
    keywords: ["mcp", "server", "tool", "external"],
  },
  {
    id: "settings-workflows",
    tabKey: "workflows",
    titleKey: "commandPalette.actions.openWorkflowSettings",
    fallbackTitle: "Open Workflow Settings",
    subtitleKey: "commandPalette.groups.settings",
    fallbackSubtitle: "System settings",
    badge: "Tools",
    keywords: ["workflow", "automation", "template"],
  },
  {
    id: "settings-hooks",
    tabKey: "hooks",
    titleKey: "commandPalette.actions.openHooks",
    fallbackTitle: "Open Hooks",
    subtitleKey: "commandPalette.groups.settings",
    fallbackSubtitle: "System settings",
    badge: "Tools",
    keywords: ["hook", "event", "trigger", "callback"],
  },
  {
    id: "settings-schedules",
    tabKey: "schedules",
    titleKey: "commandPalette.actions.openSchedulesSettings",
    fallbackTitle: "Open Schedules",
    subtitleKey: "commandPalette.groups.settings",
    fallbackSubtitle: "System settings",
    badge: "Ops",
    keywords: ["schedule", "cron", "recurring", "timer", "automated"],
  },
  {
    id: "settings-sessions",
    tabKey: "sessions",
    titleKey: "commandPalette.actions.openSessionsSettings",
    fallbackTitle: "Open Session Monitor",
    subtitleKey: "commandPalette.groups.settings",
    fallbackSubtitle: "System settings",
    badge: "Monitor",
    keywords: ["session", "monitor", "cleanup", "history"],
  },
  {
    id: "settings-metrics",
    tabKey: "metrics",
    titleKey: "commandPalette.actions.openMetrics",
    fallbackTitle: "Open Metrics Dashboard",
    subtitleKey: "commandPalette.groups.settings",
    fallbackSubtitle: "System settings",
    badge: "Monitor",
    keywords: ["metrics", "dashboard", "analytics", "usage", "stats"],
  },
  {
    id: "settings-masking",
    tabKey: "masking",
    titleKey: "commandPalette.actions.openMasking",
    fallbackTitle: "Open Keyword Masking",
    subtitleKey: "commandPalette.groups.settings",
    fallbackSubtitle: "Security & privacy",
    badge: "Security",
    keywords: ["mask", "redact", "privacy", "keyword", "sensitive"],
  },
  {
    id: "settings-env",
    tabKey: "env-vars",
    titleKey: "commandPalette.actions.openEnvVars",
    fallbackTitle: "Open Environment Variables",
    subtitleKey: "commandPalette.groups.settings",
    fallbackSubtitle: "System settings",
    badge: "System",
    keywords: ["env", "environment", "variable", "config"],
  },
  {
    id: "settings-config",
    tabKey: "config",
    titleKey: "commandPalette.actions.openConfig",
    fallbackTitle: "Open Configuration",
    subtitleKey: "commandPalette.groups.settings",
    fallbackSubtitle: "System settings",
    badge: "System",
    keywords: ["config", "json", "bamboo", "data", "path"],
  },
  {
    id: "settings-app",
    tabKey: "app",
    titleKey: "commandPalette.actions.openAppSettings",
    fallbackTitle: "Open App Settings",
    subtitleKey: "commandPalette.groups.settings",
    fallbackSubtitle: "System settings",
    badge: "System",
    keywords: ["app", "application", "reset", "theme", "language"],
  },
];

const buildSessionKeywords = (chat: CommandPaletteSession, isRunning: boolean): string[] => {
  const keywords = [chat.title, chat.id, chat.kind || "root"];
  if (chat.pinned) keywords.push("pinned", "pin");
  if (isRunning) keywords.push("running", "processing");
  if (chat.workspacePath) keywords.push(chat.workspacePath);
  if (chat.updatedAt) keywords.push(chat.updatedAt);
  return keywords.filter(Boolean);
};

const getSessionSubtitle = (
  chat: CommandPaletteSession,
  childSessionLabel: string,
  rootSessionLabel: string,
) => {
  const segments: string[] = [];
  if (chat.kind === "child") {
    segments.push(childSessionLabel);
  } else {
    segments.push(rootSessionLabel);
  }
  if (chat.workspacePath) {
    segments.push(chat.workspacePath);
  }
  if (chat.updatedAt) {
    try {
      // Follow the app's chosen language, not the browser default (#168).
      segments.push(new Date(chat.updatedAt).toLocaleString(getActiveLocaleTag()));
    } catch {
      segments.push(chat.updatedAt);
    }
  }
  return segments.join(" • ");
};

const filterActions = (actions: CommandPaletteAction[], query: string): CommandPaletteAction[] => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return actions;
  }

  return actions.filter((action) => {
    const haystack = [action.title, action.subtitle || "", ...action.keywords]
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalized);
  });
};

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  if (target.isContentEditable) return true;
  return tagName === "input" || tagName === "textarea" || tagName === "select";
};

const COMMAND_PALETTE_FORCE_OPEN_KEY = "__LOTUS_COMMAND_PALETTE_FORCE_OPEN__";

export const CommandPalette: React.FC = () => {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const isVdiSafeMode =
    typeof document !== "undefined" && document.body.getAttribute("data-vdi-safe") === "true";
  const { message } = AntdApp.useApp();
  const chats = useAppStore((state) => projectCommandPaletteSessions(state.chats));
  const addChat = useAppStore((state) => state.addChat);
  const lastSelectedPromptId = useAppStore((state) => state.lastSelectedPromptId);
  const systemPrompts = useAppStore((state) => state.systemPrompts);
  const busySessionIds = useAppStore(
    useShallow((state) =>
      Object.entries(state.executionBySession)
        .filter(([, entry]) => isBusyPhase(entry.phase))
        .map(([sessionId]) => sessionId)
        .sort(),
    ),
  );
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    const shouldForceOpen = (
      window as typeof window & {
        [COMMAND_PALETTE_FORCE_OPEN_KEY]?: boolean;
      }
    )[COMMAND_PALETTE_FORCE_OPEN_KEY];
    if (shouldForceOpen) {
      delete (
        window as typeof window & {
          [COMMAND_PALETTE_FORCE_OPEN_KEY]?: boolean;
        }
      )[COMMAND_PALETTE_FORCE_OPEN_KEY];
      return true;
    }
    return false;
  });
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<InputRef | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const openSettings = useSettingsViewStore((state) => state.open);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const themeMode = useThemeStore((state) => state.themeMode);
  const sidebarCollapsed = useUILayoutStore((state) => state.sidebar.collapsed);
  const setSidebarCollapsed = useUILayoutStore((state) => state.setSidebarCollapsed);
  const experienceMode = useExperienceModeStore((state) => state.mode);
  const toggleExperienceMode = useExperienceModeStore((state) => state.toggleMode);

  const createNewSession = useCallback(async () => {
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

    const { activeLeafId, setLeafSessionId, setActiveLeafId } = useUILayoutStore.getState();
    setLeafSessionId(activeLeafId, newSessionId);
    setActiveLeafId(activeLeafId);
  }, [addChat, lastSelectedPromptId, systemPrompts, t]);

  const baseActions = useMemo<CommandPaletteAction[]>(() => {
    const settingsActions: CommandPaletteAction[] = SETTINGS_ACTIONS.filter((item) => {
      // In simple mode, hide advanced-only settings tabs
      if (experienceMode === "simple" && ADVANCED_ONLY_SETTINGS_TABS.has(item.tabKey)) {
        return false;
      }
      return true;
    }).map((item) => ({
      id: item.id,
      kind: "action",
      title: t(item.titleKey, item.fallbackTitle),
      subtitle: t(
        item.subtitleKey || "commandPalette.groups.settings",
        item.fallbackSubtitle || "System settings",
      ),
      keywords: [item.tabKey, item.badge || "", "settings", "config", ...(item.keywords || [])],
      icon: <SettingOutlined />,
      badge: item.badge,
      onSelect: () => {
        openSettings("chat", item.tabKey);
      },
    }));

    return [
      {
        id: "new-session",
        kind: "action",
        title: t("commandPalette.actions.newSession"),
        subtitle: t("commandPalette.groups.quickActions"),
        keywords: ["new", "create", "session", "chat", "conversation"],
        icon: <PlusOutlined />,
        badge: t("commandPalette.badges.quickAction"),
        onSelect: async () => {
          await createNewSession();
        },
      },
      {
        id: "toggle-theme",
        kind: "action",
        title:
          themeMode === "dark"
            ? t("commandPalette.actions.switchToLight")
            : t("commandPalette.actions.switchToDark"),
        subtitle: t("commandPalette.groups.quickActions"),
        keywords: ["theme", "dark", "light", "mode", "appearance", "toggle", "color"],
        icon: <BgColorsOutlined />,
        badge: themeMode === "dark" ? "☀️" : "🌙",
        onSelect: () => {
          toggleTheme();
        },
      },
      {
        id: "toggle-sidebar",
        kind: "action",
        title: sidebarCollapsed
          ? t("commandPalette.actions.showSidebar")
          : t("commandPalette.actions.hideSidebar"),
        subtitle: t("commandPalette.groups.quickActions"),
        keywords: ["sidebar", "toggle", "hide", "show", "panel", "menu"],
        icon: sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />,
        badge: "Layout",
        onSelect: () => {
          setSidebarCollapsed(!sidebarCollapsed);
        },
      },
      {
        id: "open-agenda",
        kind: "action",
        title: t("commandPalette.actions.openAgenda"),
        subtitle: t("commandPalette.groups.quickActions"),
        keywords: ["agenda", "ledger", "todo", "task", "reminder", "event", "habit", "due"],
        icon: <CalendarOutlined />,
        badge: t("commandPalette.badges.quickAction"),
        onSelect: () => {
          useLedgerViewStore.getState().open();
        },
      },
      {
        id: "split-pane",
        kind: "action",
        title: t("commandPalette.actions.splitPane"),
        subtitle: t("commandPalette.groups.quickActions"),
        keywords: ["split", "pane", "multi", "dual", "side", "layout"],
        icon: <LayoutOutlined />,
        badge: "Layout",
        onSelect: () => {
          const { tree, activeLeafId, splitLeaf } = useUILayoutStore.getState();
          const leafIds = getLeafIdsFromTree(tree);
          if (leafIds.length < 4) {
            splitLeaf(activeLeafId, "vertical");
          }
        },
      },
      ...settingsActions,
      {
        id: "toggle-experience-mode",
        kind: "action",
        title:
          experienceMode === "simple"
            ? t("commandPalette.actions.switchToAdvanced")
            : t("commandPalette.actions.switchToSimple"),
        subtitle: t("commandPalette.groups.quickActions"),
        keywords: ["mode", "simple", "advanced", "beginner", "expert", "experience", "complexity"],
        icon: <ExperimentOutlined />,
        badge: experienceMode === "simple" ? "Simple" : "Advanced",
        onSelect: () => {
          toggleExperienceMode();
        },
      },
    ];
  }, [
    createNewSession,
    openSettings,
    toggleTheme,
    themeMode,
    sidebarCollapsed,
    setSidebarCollapsed,
    experienceMode,
    toggleExperienceMode,
    t,
  ]);

  const sessionActions = useMemo<CommandPaletteAction[]>(() => {
    if (!open) {
      return [];
    }
    const busySessionIdSet = new Set(busySessionIds);
    return chats.map((chat) => {
      const isRunning = busySessionIdSet.has(chat.id);
      return {
        id: `session-${chat.id}`,
        kind: "session",
        title: chat.title,
        subtitle: getSessionSubtitle(
          chat,
          t("commandPalette.badges.childSession"),
          t("commandPalette.badges.rootSession"),
        ),
        keywords: buildSessionKeywords(chat, isRunning),
        icon: <MessageOutlined />,
        badge: chat.pinned
          ? t("commandPalette.badges.pinned")
          : isRunning
            ? t("commandPalette.badges.running")
            : chat.kind === "child"
              ? t("commandPalette.badges.child")
              : undefined,
        onSelect: () => {
          openSession(chat.id);
        },
      };
    });
  }, [open, busySessionIds, chats, t]);

  const actions = useMemo(() => [...baseActions, ...sessionActions], [baseActions, sessionActions]);

  const filteredActions = useMemo(
    () => filterActions(actions, query).slice(0, 40),
    [actions, query],
  );

  useEffect(() => {
    setSelectedIndex((prev) => {
      if (filteredActions.length === 0) return 0;
      return Math.min(prev, filteredActions.length - 1);
    });
  }, [filteredActions.length]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onKeyDown = (event: KeyboardEvent) => {
      const isOpenShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (isOpenShortcut) {
        event.preventDefault();
        setOpen((prev) => !prev);
        return;
      }

      if (!open) return;

      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }

      if (
        isEditableTarget(event.target) &&
        event.key !== "ArrowUp" &&
        event.key !== "ArrowDown" &&
        event.key !== "Enter"
      ) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((prev) =>
          filteredActions.length === 0 ? 0 : (prev + 1) % filteredActions.length,
        );
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((prev) => {
          if (filteredActions.length === 0) return 0;
          return prev === 0 ? filteredActions.length - 1 : prev - 1;
        });
        return;
      }

      if (event.key === "Enter") {
        const selected = filteredActions[selectedIndex];
        if (!selected) return;
        event.preventDefault();
        void (async () => {
          try {
            await selected.onSelect();
            setOpen(false);
            setQuery("");
          } catch (error) {
            console.error("[CommandPalette] action failed", error);
            message.error(
              error instanceof Error ? error.message : t("commandPalette.errors.actionFailed"),
            );
          }
        })();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filteredActions, message, open, selectedIndex, t]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setSelectedIndex(0);
    }
  }, [open]);

  // If MainLayout requested a force-open just before this lazy chunk mounted,
  // consume that one-shot flag here as a safety net.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const shouldForceOpen = (
      window as typeof window & {
        [COMMAND_PALETTE_FORCE_OPEN_KEY]?: boolean;
      }
    )[COMMAND_PALETTE_FORCE_OPEN_KEY];
    if (!shouldForceOpen) return;

    delete (
      window as typeof window & {
        [COMMAND_PALETTE_FORCE_OPEN_KEY]?: boolean;
      }
    )[COMMAND_PALETTE_FORCE_OPEN_KEY];
    setOpen(true);
  }, []);

  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const selectedElement = container.querySelector<HTMLElement>(
      `[data-command-index=\"${selectedIndex}\"]`,
    );
    selectedElement?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  return (
    <Modal
      open={open}
      onCancel={() => setOpen(false)}
      footer={null}
      centered
      width={680}
      destroyOnClose
      className="lotus-command-palette-modal"
      title={null}
      closable={false}
      styles={{
        content: {
          padding: 12,
          borderRadius: token.borderRadiusLG,
          overflow: "hidden",
          background: token.colorBgElevated,
          backdropFilter: isVdiSafeMode ? "none" : "blur(18px)",
          WebkitBackdropFilter: isVdiSafeMode ? "none" : "blur(18px)",
        },
        body: {
          padding: 0,
        },
        mask: {
          backdropFilter: isVdiSafeMode ? "none" : "blur(6px)",
          WebkitBackdropFilter: isVdiSafeMode ? "none" : "blur(6px)",
        },
      }}
    >
      <div className="lotus-command-palette-shell">
        <div className="lotus-command-palette-search">
          <SearchOutlined style={{ color: token.colorTextTertiary, fontSize: 16 }} />
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            variant="borderless"
            placeholder={t("commandPalette.searchPlaceholder")}
            aria-label={t("commandPalette.searchPlaceholder")}
            role="combobox"
            aria-expanded={true}
            aria-controls="lotus-command-palette-listbox"
            aria-activedescendant={
              filteredActions.length > 0
                ? `lotus-command-palette-option-${
                    // Clamp at render time (#167): the effect-based clamp
                    // runs after paint, leaving one frame with a dangling
                    // "…-undefined" IDREF when filtering shrinks the list.
                    filteredActions[Math.min(selectedIndex, filteredActions.length - 1)]?.id
                  }`
                : undefined
            }
            suffix={
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                ⌘K
              </Typography.Text>
            }
          />
        </div>

        <div className="lotus-command-palette-hint">
          <ClockCircleOutlined />
          <span>{t("commandPalette.navigationHint")}</span>
        </div>

        <div
          ref={listRef}
          className="lotus-command-palette-list"
          role="listbox"
          id="lotus-command-palette-listbox"
        >
          {filteredActions.length === 0 ? (
            <div className="lotus-command-palette-empty">
              <AppstoreOutlined />
              <span>{t("commandPalette.empty")}</span>
            </div>
          ) : (
            filteredActions.map((action, index) => {
              const isSelected = index === selectedIndex;
              return (
                <button
                  key={action.id}
                  id={`lotus-command-palette-option-${action.id}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`lotus-command-palette-item ${isSelected ? "is-selected" : ""}`}
                  data-command-index={index}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => {
                    void (async () => {
                      try {
                        await action.onSelect();
                        setOpen(false);
                        setQuery("");
                      } catch (error) {
                        console.error("[CommandPalette] action failed", error);
                        message.error(
                          error instanceof Error
                            ? error.message
                            : t("commandPalette.errors.actionFailed"),
                        );
                      }
                    })();
                  }}
                >
                  <span className="lotus-command-palette-item-icon">{action.icon}</span>
                  <span className="lotus-command-palette-item-content">
                    <span className="lotus-command-palette-item-title-row">
                      <span className="lotus-command-palette-item-title">{action.title}</span>
                      {action.badge ? <Tag bordered={false}>{action.badge}</Tag> : null}
                    </span>
                    {action.subtitle ? (
                      <span className="lotus-command-palette-item-subtitle">{action.subtitle}</span>
                    ) : null}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </Modal>
  );
};

export default CommandPalette;
