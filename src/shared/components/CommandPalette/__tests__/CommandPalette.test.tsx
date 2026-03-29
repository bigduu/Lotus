import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { App as AntdApp } from "antd";

import { CommandPalette } from "../index";
import { useAppStore } from "@pages/ChatPage/store";
import { useSettingsViewStore } from "@shared/store/settingsViewStore";

vi.mock("@pages/ChatPage/utils/openSession", () => ({
  openSession: vi.fn(),
}));

describe("CommandPalette", () => {
  beforeEach(() => {
    useSettingsViewStore.setState({
      isOpen: false,
      origin: "chat",
      activeTabKey: "provider",
    });

    useAppStore.setState((state) => ({
      ...state,
      chats: [
        {
          id: "session-1",
          title: "Investigate token budget",
          kind: "root",
          createdAt: Date.now(),
          messages: [],
          config: {
            systemPromptId: "general_assistant",
            baseSystemPrompt: "You are helpful.",
            lastUsedEnhancedPrompt: null,
          },
          currentInteraction: null,
          pinned: true,
          updatedAt: new Date().toISOString(),
        },
      ],
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

  it("opens with cmd/ctrl+k and renders actions", async () => {
    render(
      <AntdApp>
        <CommandPalette />
      </AntdApp>,
    );

    fireEvent.keyDown(window, { key: "k", metaKey: true });

    expect(
      await screen.findByPlaceholderText("Search sessions, settings, and actions"),
    ).toBeInTheDocument();
    expect(screen.getByText("Create New Session")).toBeInTheDocument();
    expect(screen.getByText("Investigate token budget")).toBeInTheDocument();
  });

  it("filters results by query", async () => {
    render(
      <AntdApp>
        <CommandPalette />
      </AntdApp>,
    );

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const input = await screen.findByPlaceholderText("Search sessions, settings, and actions");
    fireEvent.change(input, { target: { value: "mcp" } });

    await waitFor(() => {
      expect(screen.getByText("Open MCP Settings")).toBeInTheDocument();
    });
  });
});
