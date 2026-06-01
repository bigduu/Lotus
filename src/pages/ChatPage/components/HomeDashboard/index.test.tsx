import { render, screen } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HomeDashboard } from "./index";
import { useAppStore } from "@shared/store/appStore";
import { useSettingsViewStore } from "@shared/store/settingsViewStore";
import { useUILayoutStore } from "@shared/store/uiLayoutStore";

const RUNNING_SESSION = {
  id: "session-running",
  title: "Investigate flaky tests",
  kind: "root" as const,
  createdAt: 1710000000000,
  updatedAt: new Date().toISOString(),
  messageCount: 12,
  isRunning: true,
  pinned: false,
  config: {
    systemPromptId: "general_assistant",
    baseSystemPrompt: "You are helpful.",
    lastUsedEnhancedPrompt: null,
    workspacePath: "/workspace/project",
  },
  messages: [],
  currentInteraction: null,
};

describe("HomeDashboard", () => {
  beforeEach(() => {
    useSettingsViewStore.setState({
      isOpen: false,
      origin: "chat",
      activeTabKey: "provider",
    });

    useUILayoutStore.setState({
      sidebar: {
        collapsed: false,
        widthPx: 260,
        collapsedWidthPx: 72,
        minWidthPx: 180,
        maxWidthPx: 520,
      },
      tree: { type: "leaf", id: "pane-a" },
      activeLeafId: "pane-a",
      leafSessionIds: { "pane-a": null },
      splitSizesPx: {},
    } as any);

    useAppStore.setState((state: any) => ({
      ...state,
      chats: [RUNNING_SESSION],
      currentSessionId: null,
      latestActiveSessionId: null,
      systemPrompts: [
        {
          id: "general_assistant",
          name: "Bodhi",
          content: "You are helpful.",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          isDefault: true,
        },
      ],
      lastSelectedPromptId: "general_assistant",
      inputStates: {},
      processingChats: new Set(["session-running"]),
      executionBySession: {
        "session-running": {
          sessionId: "session-running",
          phase: "running",
          confidence: "summary",
          activeReasons: ["summary:is_running"],
          generation: 1,
          backendRunId: null,
          stream: {
            hasTokens: false,
            tokenCount: 0,
            activeToolCalls: [],
            lastStatusHint: null,
          },
          backend: {
            isRunning: true,
            lastRunStatus: null,
            lastRunError: null,
            syncedAt: new Date().toISOString(),
            hasPendingQuestion: null,
            runningChildCount: null,
          },
          interaction: {
            pendingQuestion: null,
            respondMode: null,
            pendingApproval: null,
          },
          children: {
            byId: {},
            runningCount: 0,
          },
          timestamps: {
            optimisticAt: null,
            confirmedAt: new Date().toISOString(),
            firstTokenAt: null,
            terminalAt: null,
            settlingStartedAt: null,
            settledAt: null,
          },
          error: null,
        },
      },
      addChat: vi.fn(async () => "session-created"),
      setInputContent: vi.fn(),
      selectSession: vi.fn(),
    }));
  });

  it("shows Bodhi capability starters alongside session overview content", () => {
    render(
      <AntdApp>
        <HomeDashboard onOpenSession={vi.fn()} onCreateSession={vi.fn()} />
      </AntdApp>,
    );

    expect(screen.getByText("Welcome to Bodhi")).toBeInTheDocument();
    expect(screen.getAllByText("Start with a task").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Code review" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Write documentation" })).toBeInTheDocument();
    expect(screen.getByText("Running Now")).toBeInTheDocument();
    expect(screen.queryByText("Quick Actions")).not.toBeInTheDocument();
  });
});
