import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { App as AntdApp } from "antd";

import { ChatSidebar } from "../ChatSidebar";
import { useAppStore } from "@pages/ChatPage/store";
import { useUILayoutStore } from "@shared/store/uiLayoutStore";

vi.mock("antd", async () => {
  const actual = await vi.importActual<typeof import("antd")>("antd");
  return {
    ...actual,
    Grid: {
      ...actual.Grid,
      useBreakpoint: () => ({ xs: true, sm: true, md: true, lg: true, xl: false, xxl: false }),
    },
  };
});

vi.mock("../SystemPromptSelector", () => ({
  default: () => null,
}));

vi.mock("../../hooks/useChatManager/useChatTitleGeneration", () => ({
  useChatTitleGeneration: () => ({
    generateChatTitle: vi.fn(),
    titleGenerationState: {},
  }),
}));

describe("ChatSidebar", () => {
  beforeEach(() => {
    useUILayoutStore.setState((state) => ({
      ...state,
      sidebar: {
        ...state.sidebar,
        collapsed: false,
      },
      tree: { type: "leaf", id: "lt" },
      activeLeafId: "lt",
      leafSessionIds: { lt: "root-billing" },
      splitSizesPx: {},
    }));

    useAppStore.setState((state) => ({
      ...state,
      chats: [
        {
          id: "root-billing",
          title: "Billing investigation",
          kind: "root",
          createdAt: 1710000000000,
          messages: [],
          config: {
            systemPromptId: "general_assistant",
            baseSystemPrompt: "You are helpful.",
            lastUsedEnhancedPrompt: null,
          },
          currentInteraction: null,
          updatedAt: new Date("2025-03-01T12:00:00Z").toISOString(),
        },
        {
          id: "root-platform",
          title: "Platform roadmap",
          kind: "root",
          createdAt: 1710100000000,
          messages: [],
          config: {
            systemPromptId: "general_assistant",
            baseSystemPrompt: "You are helpful.",
            lastUsedEnhancedPrompt: null,
          },
          currentInteraction: null,
          updatedAt: new Date("2025-03-02T12:00:00Z").toISOString(),
        },
        {
          id: "child-billing-fix",
          title: "Billing child fix",
          kind: "child",
          parentSessionId: "root-billing",
          rootSessionId: "root-billing",
          createdAt: 1710001000000,
          messages: [],
          config: {
            systemPromptId: "general_assistant",
            baseSystemPrompt: "You are helpful.",
            lastUsedEnhancedPrompt: null,
          },
          currentInteraction: null,
          updatedAt: new Date("2025-03-01T13:00:00Z").toISOString(),
        },
      ],
      currentSessionId: "root-billing",
      systemPrompts: [
        {
          id: "general_assistant",
          name: "General Assistant",
          content: "You are helpful.",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          isDefault: true,
        },
      ],
      lastSelectedPromptId: "general_assistant",
    }));
  });

  it("filters root sessions by search query", async () => {
    render(
      <AntdApp>
        <ChatSidebar />
      </AntdApp>,
    );

    const searchInput = await screen.findByPlaceholderText("Search sessions");
    fireEvent.change(searchInput, { target: { value: "billing" } });

    await waitFor(() => {
      expect(screen.getByText("Billing investigation")).toBeInTheDocument();
      expect(screen.queryByText("Platform roadmap")).toBeNull();
    });
  });

  it("shows matching child sessions when child filter is active", async () => {
    render(
      <AntdApp>
        <ChatSidebar />
      </AntdApp>,
    );

    const childFilter = document.querySelector<HTMLElement>(
      '.ant-segmented-item-label[title="Child"]',
    );
    expect(childFilter).not.toBeNull();
    fireEvent.click(childFilter as HTMLElement);

    await waitFor(() => {
      expect(screen.getByText("Billing investigation")).toBeInTheDocument();
      expect(screen.getByText("Billing child fix")).toBeInTheDocument();
      expect(screen.queryByText("Platform roadmap")).toBeNull();
    });
  });

  it("shows the running app version in the sidebar footer", async () => {
    render(
      <AntdApp>
        <ChatSidebar />
      </AntdApp>,
    );

    expect(await screen.findByTestId("app-version-badge")).toHaveTextContent("2026.3.111");
  });
});
