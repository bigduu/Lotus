import React, { useCallback, useMemo, useState } from "react";
import { App as AntApp, Input, Typography, theme } from "antd";
import {
  ApartmentOutlined,
  ArrowRightOutlined,
  BarChartOutlined,
  BugOutlined,
  ClockCircleOutlined,
  CodeOutlined,
  DiffOutlined,
  FileTextOutlined,
  FolderViewOutlined,
  LoadingOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  ReadOutlined,
  SearchOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";

import { selectSessionById, useAppStore } from "@shared/store/appStore";
import { assignSessionToActiveLeaf } from "../../utils/assignSessionToActiveLeaf";
import { CHAT_FOCUS_INPUT_EVENT } from "../ChatView/events";

import "./index.css";

type PromptLike = {
  id: string;
  content: string;
};

type TemplateCategory = "development" | "debugging" | "analysis" | "documentation" | "operations";

type LauncherTemplate = {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  sessionTitle: string;
  prefill: string;
  baseSystemPrompt?: string;
  category: TemplateCategory;
  recommendWorkspace?: boolean;
};

export type EmptyTaskLauncherProps = {
  sessionId?: string | null;
  embedded?: boolean;
  hideHeader?: boolean;
  layoutMode?: "default" | "staggered";
};

/* ---------- system prompts ---------- */

const CODE_REVIEW_SYSTEM_PROMPT = [
  "You are Bodhi operating in code review mode.",
  "Review code changes with emphasis on correctness, regressions, security, maintainability, tests, and rollout risk.",
  "Prefer concise findings with severity, rationale, and actionable fixes.",
  "Ask for missing scope or repository context before making strong assumptions.",
].join(" ");

const BUG_INVESTIGATION_SYSTEM_PROMPT = [
  "You are Bodhi operating in bug investigation mode.",
  "Help diagnose issues by analyzing code, logs, stack traces, and runtime behavior.",
  "Trace root causes methodically, suggest targeted fixes, and flag related risks.",
  "Ask for reproduction steps or error messages if not provided.",
].join(" ");

const IMPLEMENT_FEATURE_SYSTEM_PROMPT = [
  "You are Bodhi operating in feature implementation mode.",
  "Help plan and implement new features step by step, following existing code conventions.",
  "Consider edge cases, testing strategies, and backward compatibility.",
  "Propose an implementation plan before writing code when scope is large.",
].join(" ");

const ARCHITECTURE_REVIEW_SYSTEM_PROMPT = [
  "You are Bodhi operating in architecture analysis mode.",
  "Analyze the repository structure, key abstractions, data flow, and module boundaries.",
  "Identify architectural patterns, coupling hotspots, and potential improvements.",
  "Use diagrams to illustrate relationships when helpful.",
].join(" ");

const EXPLAIN_ERROR_SYSTEM_PROMPT = [
  "You are Bodhi operating in error explanation mode.",
  "Help users understand error messages, stack traces, and unexpected behavior.",
  "Explain the root cause clearly, suggest fixes, and provide prevention tips.",
  "Keep explanations accessible even for less experienced developers.",
].join(" ");

const COMPARE_FILES_SYSTEM_PROMPT = [
  "You are Bodhi operating in file comparison mode.",
  "Compare the given files or code sections, highlighting key differences and their implications.",
  "Focus on functional changes, potential regressions, and design trade-offs.",
].join(" ");

const REFACTOR_SYSTEM_PROMPT = [
  "You are Bodhi operating in refactoring advisor mode.",
  "Suggest targeted refactoring improvements for readability, maintainability, and performance.",
  "Respect existing code style, propose incremental changes, and explain the rationale.",
  "Flag any risks introduced by the refactoring.",
].join(" ");

const RELEASE_NOTES_SYSTEM_PROMPT = [
  "You are Bodhi operating in release notes generation mode.",
  "Generate clear, well-structured release notes from git history and code changes.",
  "Categorize changes (features, fixes, improvements, breaking changes).",
  "Write for both technical and non-technical readers.",
].join(" ");

const SUMMARIZE_WORK_SYSTEM_PROMPT = [
  "You are Bodhi operating in work summary mode.",
  "Help summarize recent work activity for standups, weeklies, or status reports.",
  "Pull key accomplishments, blockers, and next steps from session history or code changes.",
  "Keep output concise and actionable.",
].join(" ");

const WRITE_DOCS_SYSTEM_PROMPT = [
  "You are Bodhi operating in documentation writer mode.",
  "Help create or improve technical documentation from code and project context.",
  "Follow good documentation practices: clear structure, examples, and consistent terminology.",
  "Produce Markdown-formatted output by default.",
].join(" ");

const SCHEDULED_TASK_SYSTEM_PROMPT = [
  "You are Bodhi operating in scheduled task setup mode.",
  "Help the user create a recurring scheduled task in Bamboo.",
  "Clarify the task goal, frequency, workspace, and expected output before proceeding.",
  "Guide the user through configuration and confirm before saving.",
].join(" ");

const SESSION_REVIEW_SYSTEM_PROMPT = [
  "You are Bodhi operating in session review mode.",
  "Help inspect and analyze past session history for patterns, insights, or issues.",
  "Summarize key decisions, outcomes, and areas that may need follow-up.",
].join(" ");

const TOKEN_USAGE_SYSTEM_PROMPT = [
  "You are Bodhi operating in context diagnostics mode.",
  "Help analyze token usage, prompt bloat, context growth, truncation, and compression behavior.",
  "Quantify likely causes when possible and recommend concrete, prioritized fixes.",
  "Keep the output practical for engineers improving prompt and session efficiency.",
].join(" ");

/* ---------- helpers ---------- */

const CATEGORY_ORDER: TemplateCategory[] = [
  "development",
  "debugging",
  "analysis",
  "documentation",
  "operations",
];

const CATEGORY_LABELS: Record<TemplateCategory, { titleKey: string; fallback: string }> = {
  development: { titleKey: "chat.emptyLauncher.categories.development", fallback: "Development" },
  debugging: { titleKey: "chat.emptyLauncher.categories.debugging", fallback: "Debugging" },
  analysis: { titleKey: "chat.emptyLauncher.categories.analysis", fallback: "Analysis" },
  documentation: {
    titleKey: "chat.emptyLauncher.categories.documentation",
    fallback: "Documentation",
  },
  operations: { titleKey: "chat.emptyLauncher.categories.operations", fallback: "Operations" },
};

const resolveDefaultPromptConfig = (
  systemPrompts: PromptLike[],
  lastSelectedPromptId?: string | null,
) => {
  const selectedPrompt = systemPrompts.find((prompt) => prompt.id === lastSelectedPromptId);
  const fallbackPrompt =
    systemPrompts.find((prompt) => prompt.id === "general_assistant") || systemPrompts[0];

  return {
    systemPromptId: selectedPrompt?.id || fallbackPrompt?.id || "",
    baseSystemPrompt: selectedPrompt?.content || fallbackPrompt?.content || "",
  };
};

/* ---------- component ---------- */

export const EmptyTaskLauncher: React.FC<EmptyTaskLauncherProps> = ({
  sessionId = null,
  embedded = false,
  hideHeader = false,
  layoutMode = "default",
}) => {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const { message, modal } = AntApp.useApp();
  const currentSessionId = useAppStore((state) => sessionId ?? state.currentSessionId);
  const currentChat = useAppStore(selectSessionById(currentSessionId));
  const addChat = useAppStore((state) => state.addChat);
  const lastSelectedPromptId = useAppStore((state) => state.lastSelectedPromptId);
  const setInputContent = useAppStore((state) => state.setInputContent);
  const systemPrompts = useAppStore((state) => state.systemPrompts);
  // Lotus #134 / Bamboo #692 — the default context for a new session may
  // only come from the current session or the active Project's authoritative
  // primary path. Never infer it from workspace binding order or another chat.
  const activeProjectPath = useAppStore((state) => {
    const projectId = state.activeProjectId;
    if (!projectId) return null;
    const project = state.projects[projectId];
    return project?.project_path_status === "configured" ? project.project_path : null;
  });
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const workspacePath = currentChat?.config.workspacePath ?? activeProjectPath ?? undefined;

  /* ---- templates ---- */

  const templates = useMemo<LauncherTemplate[]>(
    () => [
      /* -- Development -- */
      {
        id: "blank",
        icon: <PlusOutlined />,
        title: t("chat.emptyLauncher.actions.blank.title", "Blank session"),
        description: t(
          "chat.emptyLauncher.actions.blank.description",
          "Start from scratch with the default assistant and an empty composer.",
        ),
        sessionTitle: t("chat.emptyLauncher.actions.blank.sessionTitle", "New Session"),
        prefill: t("chat.emptyLauncher.actions.blank.prefill", ""),
        category: "development",
      },
      {
        id: "codeReview",
        icon: <CodeOutlined />,
        title: t("chat.emptyLauncher.actions.codeReview.title", "Code review"),
        description: t(
          "chat.emptyLauncher.actions.codeReview.description",
          "Open a review-focused session with an editable review brief.",
        ),
        sessionTitle: t("chat.emptyLauncher.actions.codeReview.sessionTitle", "Code Review"),
        prefill: t(
          "chat.emptyLauncher.actions.codeReview.prefill",
          "Review the relevant code changes in this workspace or repository. Start with the overall scope, then list risks, notable diffs, and the most important fixes.",
        ),
        baseSystemPrompt: CODE_REVIEW_SYSTEM_PROMPT,
        category: "development",
        recommendWorkspace: true,
      },
      {
        id: "implementFeature",
        icon: <ToolOutlined />,
        title: t("chat.emptyLauncher.actions.implementFeature.title", "Implement feature"),
        description: t(
          "chat.emptyLauncher.actions.implementFeature.description",
          "Plan and build a feature step by step following existing code conventions.",
        ),
        sessionTitle: t(
          "chat.emptyLauncher.actions.implementFeature.sessionTitle",
          "Implement Feature",
        ),
        prefill: t(
          "chat.emptyLauncher.actions.implementFeature.prefill",
          "Help me implement a new feature in this workspace. Start by understanding the codebase structure, then propose an implementation plan before writing code.",
        ),
        baseSystemPrompt: IMPLEMENT_FEATURE_SYSTEM_PROMPT,
        category: "development",
        recommendWorkspace: true,
      },
      {
        id: "refactor",
        icon: <DiffOutlined />,
        title: t("chat.emptyLauncher.actions.refactor.title", "Refactor code"),
        description: t(
          "chat.emptyLauncher.actions.refactor.description",
          "Get targeted suggestions for improving code quality and maintainability.",
        ),
        sessionTitle: t("chat.emptyLauncher.actions.refactor.sessionTitle", "Refactor Suggestion"),
        prefill: t(
          "chat.emptyLauncher.actions.refactor.prefill",
          "Suggest refactoring improvements for the code in this workspace. Focus on readability, maintainability, and performance. Propose incremental changes with clear rationale.",
        ),
        baseSystemPrompt: REFACTOR_SYSTEM_PROMPT,
        category: "development",
        recommendWorkspace: true,
      },

      /* -- Debugging -- */
      {
        id: "bugInvestigation",
        icon: <BugOutlined />,
        title: t("chat.emptyLauncher.actions.bugInvestigation.title", "Bug investigation"),
        description: t(
          "chat.emptyLauncher.actions.bugInvestigation.description",
          "Diagnose issues by analyzing code, logs, and runtime behavior.",
        ),
        sessionTitle: t(
          "chat.emptyLauncher.actions.bugInvestigation.sessionTitle",
          "Bug Investigation",
        ),
        prefill: t(
          "chat.emptyLauncher.actions.bugInvestigation.prefill",
          "Help me investigate a bug. I'll describe the symptoms and share relevant code or logs. Trace the root cause and suggest targeted fixes.",
        ),
        baseSystemPrompt: BUG_INVESTIGATION_SYSTEM_PROMPT,
        category: "debugging",
        recommendWorkspace: true,
      },
      {
        id: "explainError",
        icon: <QuestionCircleOutlined />,
        title: t("chat.emptyLauncher.actions.explainError.title", "Explain error"),
        description: t(
          "chat.emptyLauncher.actions.explainError.description",
          "Understand what went wrong from an error message or stack trace.",
        ),
        sessionTitle: t("chat.emptyLauncher.actions.explainError.sessionTitle", "Explain Error"),
        prefill: t(
          "chat.emptyLauncher.actions.explainError.prefill",
          "Help me understand the following error. Explain the root cause, suggest fixes, and share prevention tips.",
        ),
        baseSystemPrompt: EXPLAIN_ERROR_SYSTEM_PROMPT,
        category: "debugging",
      },
      {
        id: "tokenUsage",
        icon: <BarChartOutlined />,
        title: t("chat.emptyLauncher.actions.tokenUsage.title", "Token usage investigation"),
        description: t(
          "chat.emptyLauncher.actions.tokenUsage.description",
          "Diagnose context growth, truncation risk, and token budget pressure.",
        ),
        sessionTitle: t(
          "chat.emptyLauncher.actions.tokenUsage.sessionTitle",
          "Token Usage Investigation",
        ),
        prefill: t(
          "chat.emptyLauncher.actions.tokenUsage.prefill",
          "Help me investigate token usage, context growth, and truncation risk for this session or workflow. Summarize the likely drivers and recommend concrete next fixes.",
        ),
        baseSystemPrompt: TOKEN_USAGE_SYSTEM_PROMPT,
        category: "debugging",
      },

      /* -- Analysis -- */
      {
        id: "architectureReview",
        icon: <ApartmentOutlined />,
        title: t("chat.emptyLauncher.actions.architectureReview.title", "Read repo architecture"),
        description: t(
          "chat.emptyLauncher.actions.architectureReview.description",
          "Analyze repository structure, modules, and architectural patterns.",
        ),
        sessionTitle: t(
          "chat.emptyLauncher.actions.architectureReview.sessionTitle",
          "Architecture Review",
        ),
        prefill: t(
          "chat.emptyLauncher.actions.architectureReview.prefill",
          "Analyze the architecture of this repository. Map the key modules, data flow, abstractions, and dependency patterns. Identify strengths and potential improvements.",
        ),
        baseSystemPrompt: ARCHITECTURE_REVIEW_SYSTEM_PROMPT,
        category: "analysis",
        recommendWorkspace: true,
      },
      {
        id: "compareFiles",
        icon: <FolderViewOutlined />,
        title: t("chat.emptyLauncher.actions.compareFiles.title", "Compare files"),
        description: t(
          "chat.emptyLauncher.actions.compareFiles.description",
          "Diff and understand differences between files or code sections.",
        ),
        sessionTitle: t("chat.emptyLauncher.actions.compareFiles.sessionTitle", "Compare Files"),
        prefill: t(
          "chat.emptyLauncher.actions.compareFiles.prefill",
          "Compare the following files or code sections. Highlight key differences, their implications, and any potential risks.",
        ),
        baseSystemPrompt: COMPARE_FILES_SYSTEM_PROMPT,
        category: "analysis",
        recommendWorkspace: true,
      },

      /* -- Documentation -- */
      {
        id: "releaseNotes",
        icon: <FileTextOutlined />,
        title: t("chat.emptyLauncher.actions.releaseNotes.title", "Generate release notes"),
        description: t(
          "chat.emptyLauncher.actions.releaseNotes.description",
          "Create structured release notes from git history and code changes.",
        ),
        sessionTitle: t("chat.emptyLauncher.actions.releaseNotes.sessionTitle", "Release Notes"),
        prefill: t(
          "chat.emptyLauncher.actions.releaseNotes.prefill",
          "Generate release notes for the latest changes in this workspace. Categorize into features, fixes, improvements, and breaking changes.",
        ),
        baseSystemPrompt: RELEASE_NOTES_SYSTEM_PROMPT,
        category: "documentation",
        recommendWorkspace: true,
      },
      {
        id: "summarizeWork",
        icon: <ReadOutlined />,
        title: t("chat.emptyLauncher.actions.summarizeWork.title", "Summarize work"),
        description: t(
          "chat.emptyLauncher.actions.summarizeWork.description",
          "Create a work summary for standups or weekly status reports.",
        ),
        sessionTitle: t("chat.emptyLauncher.actions.summarizeWork.sessionTitle", "Work Summary"),
        prefill: t(
          "chat.emptyLauncher.actions.summarizeWork.prefill",
          "Help me summarize my recent work for a status update. Pull key accomplishments, blockers, and next steps.",
        ),
        baseSystemPrompt: SUMMARIZE_WORK_SYSTEM_PROMPT,
        category: "documentation",
      },
      {
        id: "writeDocs",
        icon: <FileTextOutlined />,
        title: t("chat.emptyLauncher.actions.writeDocs.title", "Write documentation"),
        description: t(
          "chat.emptyLauncher.actions.writeDocs.description",
          "Create or improve technical documentation from code and context.",
        ),
        sessionTitle: t("chat.emptyLauncher.actions.writeDocs.sessionTitle", "Write Documentation"),
        prefill: t(
          "chat.emptyLauncher.actions.writeDocs.prefill",
          "Help me write technical documentation for this project. Analyze the code and produce clear, well-structured Markdown documentation.",
        ),
        baseSystemPrompt: WRITE_DOCS_SYSTEM_PROMPT,
        category: "documentation",
        recommendWorkspace: true,
      },

      /* -- Operations -- */
      {
        id: "createSchedule",
        icon: <ClockCircleOutlined />,
        title: t("chat.emptyLauncher.actions.createSchedule.title", "Create scheduled task"),
        description: t(
          "chat.emptyLauncher.actions.createSchedule.description",
          "Set up a recurring task that runs automatically on a schedule.",
        ),
        sessionTitle: t(
          "chat.emptyLauncher.actions.createSchedule.sessionTitle",
          "Create Schedule",
        ),
        prefill: t(
          "chat.emptyLauncher.actions.createSchedule.prefill",
          "Help me set up a recurring scheduled task. I'll describe what I want it to do, and you guide me through the configuration.",
        ),
        baseSystemPrompt: SCHEDULED_TASK_SYSTEM_PROMPT,
        category: "operations",
      },
      {
        id: "sessionReview",
        icon: <SearchOutlined />,
        title: t("chat.emptyLauncher.actions.sessionReview.title", "Review session history"),
        description: t(
          "chat.emptyLauncher.actions.sessionReview.description",
          "Inspect and analyze past sessions for patterns and insights.",
        ),
        sessionTitle: t("chat.emptyLauncher.actions.sessionReview.sessionTitle", "Session Review"),
        prefill: t(
          "chat.emptyLauncher.actions.sessionReview.prefill",
          "Help me review my recent session history. Summarize key decisions, outcomes, and areas that need follow-up.",
        ),
        baseSystemPrompt: SESSION_REVIEW_SYSTEM_PROMPT,
        category: "operations",
      },
    ],
    [t],
  );

  /* ---- search filter ---- */

  const normalizedSearch = searchQuery.trim().toLowerCase();

  const filteredTemplates = useMemo(() => {
    if (!normalizedSearch) return templates;
    return templates.filter(
      (tpl) =>
        tpl.title.toLowerCase().includes(normalizedSearch) ||
        tpl.description.toLowerCase().includes(normalizedSearch),
    );
  }, [normalizedSearch, templates]);

  const groupedByCategory = useMemo(() => {
    const groups: Partial<Record<TemplateCategory, LauncherTemplate[]>> = {};
    for (const tpl of filteredTemplates) {
      if (!groups[tpl.category]) groups[tpl.category] = [];
      groups[tpl.category]!.push(tpl);
    }
    return groups;
  }, [filteredTemplates]);

  /* ---- launch logic ---- */

  const requestComposerFocus = useCallback((targetSessionId: string) => {
    if (typeof window === "undefined") return;
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent(CHAT_FOCUS_INPUT_EVENT, {
          detail: { sessionId: targetSessionId },
        }),
      );
    }, 0);
  }, []);

  const handleLaunch = useCallback(
    async (template: LauncherTemplate) => {
      if (pendingTaskId) return;

      const launchTemplate = async () => {
        const defaultPromptConfig = resolveDefaultPromptConfig(systemPrompts, lastSelectedPromptId);
        const newSessionId = await addChat({
          title: template.sessionTitle,
          createdAt: Date.now(),
          messages: [],
          config: {
            systemPromptId: defaultPromptConfig.systemPromptId,
            baseSystemPrompt: template.baseSystemPrompt ?? defaultPromptConfig.baseSystemPrompt,
            lastUsedEnhancedPrompt: null,
            ...(workspacePath ? { workspacePath } : {}),
          },
        });

        assignSessionToActiveLeaf(newSessionId);

        if (template.prefill.trim().length > 0) {
          setInputContent(newSessionId, template.prefill);
        }

        requestComposerFocus(newSessionId);
      };

      setPendingTaskId(template.id);
      // Draft preservation (#169): the pane may already be bound to an
      // EMPTY session holding a non-empty draft. Launching a template
      // must not silently drop that context.
      const boundSessionId = sessionId ?? currentSessionId;
      const boundChat = boundSessionId
        ? useAppStore.getState().chats.find((chat) => chat.id === boundSessionId)
        : undefined;
      const boundInput = boundSessionId
        ? useAppStore.getState().inputStates[boundSessionId]
        : undefined;
      const boundDraft = boundInput?.content ?? "";
      const hasBoundContext =
        Boolean(boundChat) &&
        (boundChat?.messages.length ?? 0) === 0 &&
        (Boolean(boundDraft.trim()) ||
          (boundInput?.attachments.length ?? 0) > 0 ||
          Boolean(boundInput?.referenceText?.trim()));

      if (hasBoundContext && boundSessionId && !template.baseSystemPrompt) {
        // Prompt-less templates (e.g. blank): reuse the bound session and
        // append the prefill after a blank line — no new empty session,
        // no lost draft.
        const merged = template.prefill.trim()
          ? `${boundDraft.trimEnd()}\n\n${template.prefill}`
          : boundDraft;
        // Skip the write when nothing would change (avoids a no-op
        // store notification).
        if (merged !== boundDraft) {
          setInputContent(boundSessionId, merged);
        }
        assignSessionToActiveLeaf(boundSessionId);
        requestComposerFocus(boundSessionId);
        setPendingTaskId(null);
        return;
      }

      if (hasBoundContext && boundSessionId) {
        // Prompt-bearing templates still open a new session (the system
        // prompt is the point of the template) — confirm first and make
        // clear the draft stays in the old session. pendingTaskId stays
        // set while the dialog is open so cards can't be double-launched.
        modal.confirm({
          title: t("chat.emptyLauncher.replaceDraftTitle", "Open template in a new session?"),
          content: t(
            "chat.emptyLauncher.replaceDraftContent",
            "The template opens in a new session. Your current draft stays in the old session.",
          ),
          okText: t("common.continue", "Continue"),
          cancelText: t("common.cancel"),
          onOk: () =>
            launchTemplate()
              .catch((error: unknown) => {
                console.error("[EmptyTaskLauncher] Failed to create session", error);
                message.error(
                  error instanceof Error
                    ? error.message
                    : t("chat.emptyLauncher.errors.createFailed", "Failed to create session"),
                );
              })
              .finally(() => {
                setPendingTaskId(null);
              }),
          onCancel: () => setPendingTaskId(null),
        });
        return;
      }

      try {
        await launchTemplate();
      } catch (error) {
        console.error("[EmptyTaskLauncher] Failed to create session", error);
        message.error(
          error instanceof Error
            ? error.message
            : t("chat.emptyLauncher.errors.createFailed", "Failed to create session"),
        );
      } finally {
        setPendingTaskId(null);
      }
    },
    [
      addChat,
      currentSessionId,
      lastSelectedPromptId,
      message,
      modal,
      pendingTaskId,
      requestComposerFocus,
      sessionId,
      setInputContent,
      systemPrompts,
      t,
      workspacePath,
    ],
  );

  /* ---- render ---- */

  const rootStyle = useMemo(
    () =>
      ({
        ["--lotus-empty-launcher-border" as string]: token.colorBorderSecondary,
        ["--lotus-empty-launcher-border-hover" as string]: token.colorPrimaryBorder,
        ["--lotus-empty-launcher-bg" as string]: token.colorBgElevated,
        ["--lotus-empty-launcher-icon-bg" as string]: token.colorPrimaryBg,
        ["--lotus-empty-launcher-icon-color" as string]: token.colorPrimary,
        ["--lotus-empty-launcher-text" as string]: token.colorText,
        ["--lotus-empty-launcher-text-secondary" as string]: token.colorTextSecondary,
        ["--lotus-empty-launcher-shadow" as string]: token.boxShadowSecondary,
        ["--lotus-empty-launcher-shadow-hover" as string]: token.boxShadow,
        ["--lotus-empty-launcher-category-border" as string]: token.colorBorderSecondary,
        ["--lotus-empty-launcher-search-bg" as string]: token.colorBgContainer,
        ["--lotus-empty-launcher-badge-bg" as string]: token.colorPrimaryBg,
        ["--lotus-empty-launcher-badge-text" as string]: token.colorPrimary,
      }) as React.CSSProperties,
    [token],
  );

  const hasWorkspace = Boolean(workspacePath);

  return (
    <div
      className={`lotus-empty-task-launcher ${embedded ? "is-embedded" : ""} ${hideHeader ? "is-headerless" : ""} ${layoutMode === "staggered" ? "is-staggered" : ""}`}
      style={rootStyle}
    >
      {!hideHeader && (
        <div className="lotus-empty-task-launcher__header">
          <Typography.Title level={embedded ? 4 : 3} style={{ margin: 0 }}>
            {t("chat.emptyLauncher.title", "Start with a task")}
          </Typography.Title>
          <Typography.Paragraph type="secondary" className="lotus-empty-task-launcher__subtitle">
            {t(
              "chat.emptyLauncher.subtitle",
              "Create a focused session in this pane and prefill the first message before you send it.",
            )}
          </Typography.Paragraph>
          <Typography.Text type="secondary" className="lotus-empty-task-launcher__hint">
            {t(
              "chat.emptyLauncher.hint",
              "Nothing is sent automatically — you can edit the prompt first.",
            )}
          </Typography.Text>
        </div>
      )}

      {/* Search bar */}
      <div className="lotus-empty-task-launcher__search">
        <Input
          placeholder={t("chat.emptyLauncher.searchPlaceholder", "Search templates...")}
          prefix={<SearchOutlined style={{ color: token.colorTextQuaternary }} />}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          allowClear
          size="middle"
          variant="filled"
        />
      </div>

      {/* Categorized template grid */}
      <div className="lotus-empty-task-launcher__categories">
        {CATEGORY_ORDER.map((category) => {
          const items = groupedByCategory[category];
          if (!items || items.length === 0) return null;
          const label = CATEGORY_LABELS[category];
          return (
            <div key={category} className="lotus-empty-task-launcher__category">
              <Typography.Text
                type="secondary"
                className="lotus-empty-task-launcher__category-label"
              >
                {t(label.titleKey, label.fallback)}
              </Typography.Text>
              <div className="lotus-empty-task-launcher__grid">
                {items.map((template) => {
                  const isPending = pendingTaskId === template.id;
                  const showWorkspaceBadge = template.recommendWorkspace && hasWorkspace;
                  return (
                    <button
                      key={template.id}
                      type="button"
                      className="lotus-empty-task-card"
                      onClick={() => {
                        void handleLaunch(template);
                      }}
                      disabled={pendingTaskId !== null}
                      aria-busy={isPending}
                      aria-label={template.title}
                    >
                      <div className="lotus-empty-task-card__icon" aria-hidden>
                        {isPending ? <LoadingOutlined /> : template.icon}
                      </div>
                      <div className="lotus-empty-task-card__body">
                        <div className="lotus-empty-task-card__titleRow">
                          <span className="lotus-empty-task-card__title">{template.title}</span>
                          <ArrowRightOutlined
                            className="lotus-empty-task-card__arrow"
                            aria-hidden
                          />
                        </div>
                        <p className="lotus-empty-task-card__description">{template.description}</p>
                        {showWorkspaceBadge && (
                          <div className="lotus-empty-task-card__badges">
                            <span className="lotus-empty-task-card__badge" title={workspacePath}>
                              📂 {t("chat.emptyLauncher.badges.workspace", "workspace")}
                            </span>
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {filteredTemplates.length === 0 && (
          <div className="lotus-empty-task-launcher__no-results">
            <Typography.Text type="secondary">
              {t(
                "chat.emptyLauncher.noResults",
                "No templates match your search. Try a different keyword or start a blank session.",
              )}
            </Typography.Text>
          </div>
        )}
      </div>
    </div>
  );
};

export default EmptyTaskLauncher;
