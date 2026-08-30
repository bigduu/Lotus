import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EmptyTaskLauncher } from "./index";
import { useAppStore } from "@shared/store/appStore";
import { useUILayoutStore } from "@shared/store/uiLayoutStore";
import { CHAT_FOCUS_INPUT_EVENT } from "@pages/ChatPage/components/ChatView/events";

const BASE_SESSION = {
  id: "empty-session",
  title: "New Session",
  kind: "root" as const,
  createdAt: 1710000000000,
  messages: [],
  config: {
    systemPromptId: "general_assistant",
    baseSystemPrompt: "You are helpful.",
    lastUsedEnhancedPrompt: null,
    workspacePath: "/workspace/project",
  },
  currentInteraction: null,
};

describe("EmptyTaskLauncher", () => {
  beforeEach(() => {
    localStorage.clear();

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
      leafSessionIds: { "pane-a": "empty-session" },
      splitSizesPx: {},
    } as any);

    const addChat = vi.fn(async (chatData: any) => {
      const newSessionId =
        chatData.title === "Code Review"
          ? "session-code-review"
          : chatData.title === "Token Usage Investigation"
            ? "session-token-usage"
            : "session-blank";

      useAppStore.setState((state: any) => ({
        chats: [{ id: newSessionId, ...chatData }, ...state.chats],
        currentSessionId: newSessionId,
        latestActiveSessionId: newSessionId,
      }));

      return newSessionId;
    });

    const setInputContent = vi.fn((sessionId: string, content: string) => {
      useAppStore.setState((state: any) => ({
        inputStates: {
          ...state.inputStates,
          [sessionId]: {
            content,
            referenceText: null,
            attachments: [],
            reasoningEffort: "medium",
          },
        },
      }));
    });

    const selectSession = vi.fn((sessionId: string | null) => {
      useAppStore.setState({
        currentSessionId: sessionId,
        latestActiveSessionId: sessionId,
      } as any);
    });

    useAppStore.setState((state: any) => ({
      ...state,
      chats: [BASE_SESSION],
      currentSessionId: "empty-session",
      latestActiveSessionId: "empty-session",
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
      addChat,
      setInputContent,
      selectSession,
    }));
  });

  it("renders the starter task cards", () => {
    render(
      <AntdApp>
        <EmptyTaskLauncher sessionId="empty-session" />
      </AntdApp>,
    );

    expect(screen.getByText("Start with a task")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Blank session" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Code review" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Token usage investigation" })).toBeInTheDocument();
  });

  it("renders starter cards without an explicit session for dashboard embedding", () => {
    useAppStore.setState({
      currentSessionId: null,
      latestActiveSessionId: null,
    } as any);

    render(
      <AntdApp>
        <EmptyTaskLauncher embedded={true} />
      </AntdApp>,
    );

    expect(screen.getByText("Start with a task")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Code review" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Write documentation" })).toBeInTheDocument();
  });

  it("creates a code review session, assigns it to the active pane, prefills the input, and requests focus", async () => {
    const focusEvents: string[] = [];
    const handleFocusEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
      if (detail?.sessionId) {
        focusEvents.push(detail.sessionId);
      }
    };

    window.addEventListener(CHAT_FOCUS_INPUT_EVENT, handleFocusEvent as EventListener);

    render(
      <AntdApp>
        <EmptyTaskLauncher sessionId="empty-session" />
      </AntdApp>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Code review" }));

    await waitFor(() => {
      expect(useUILayoutStore.getState().leafSessionIds["pane-a"]).toBe("session-code-review");
    });

    const createdSession = useAppStore
      .getState()
      .chats.find((chat: any) => chat.id === "session-code-review");

    expect(createdSession).toMatchObject({
      title: "Code Review",
      titleGenerated: true,
      config: expect.objectContaining({
        workspacePath: "/workspace/project",
      }),
    });
    expect(createdSession?.config.baseSystemPrompt).toContain("code review mode");
    expect(useAppStore.getState().currentSessionId).toBe("session-code-review");
    expect(useAppStore.getState().inputStates["session-code-review"]?.content).toContain(
      "Review the relevant code changes",
    );

    await waitFor(() => {
      expect(focusEvents).toContain("session-code-review");
    });

    window.removeEventListener(CHAT_FOCUS_INPUT_EVENT, handleFocusEvent as EventListener);
  });

  it("does not inherit a workspace from an arbitrary chat when no session is active (#134)", async () => {
    // No current session: the old fallback scanned `chats` for any
    // workspacePath, which leaks a workspace across Projects. The launcher
    // must create the session with no workspace instead.
    useAppStore.setState({
      currentSessionId: null,
      latestActiveSessionId: null,
      activeProjectId: null,
    } as any);

    render(
      <AntdApp>
        <EmptyTaskLauncher embedded={true} />
      </AntdApp>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Blank session" }));

    await waitFor(() => {
      expect(useAppStore.getState().chats.some((chat: any) => chat.id === "session-blank")).toBe(
        true,
      );
    });

    const createdSession = useAppStore
      .getState()
      .chats.find((chat: any) => chat.id === "session-blank");
    expect(createdSession?.titleGenerated).toBe(false);
    expect(createdSession?.config.workspacePath).toBeUndefined();
  });

  it("uses the active Project's authoritative path when no session is active (#134/#692)", async () => {
    useAppStore.setState({
      currentSessionId: null,
      latestActiveSessionId: null,
      activeProjectId: "proj-zenith",
      projects: {
        "proj-zenith": {
          id: "proj-zenith",
          name: "zenith",
          description: null,
          status: "active",
          revision: 1,
          resource_revision: 1,
          project_path: "/repo/zenith",
          project_path_status: "configured",
          workspace_count: 1,
          created_at: "2025-03-01T00:00:00Z",
          updated_at: "2025-03-01T00:00:00Z",
          schema_version: 1,
          workspace_bindings: [],
        },
      },
    } as any);

    render(
      <AntdApp>
        <EmptyTaskLauncher embedded={true} />
      </AntdApp>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Blank session" }));

    await waitFor(() => {
      const createdSession = useAppStore
        .getState()
        .chats.find((chat: any) => chat.id === "session-blank");
      expect(createdSession?.config.workspacePath).toBe("/repo/zenith");
    });
  });

  it("reuses the bound empty session and keeps the existing draft (#169)", async () => {
    // The pane is bound to an empty session with a draft. A prompt-less
    // template must not silently switch to a brand-new session and leave
    // the draft behind.
    useAppStore.setState((state: any) => ({
      ...state,
      inputStates: {
        "empty-session": {
          content: "my existing draft",
          referenceText: null,
          attachments: [],
          reasoningEffort: "medium",
        },
      },
    }));
    const chatsBefore = useAppStore.getState().chats.length;

    render(
      <AntdApp>
        <EmptyTaskLauncher sessionId="empty-session" />
      </AntdApp>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Blank session" }));

    await waitFor(() => {
      expect(useAppStore.getState().inputStates["empty-session"]?.content).toBe(
        "my existing draft",
      );
    });
    // No new session was created.
    expect(useAppStore.getState().chats.length).toBe(chatsBefore);
    expect(useAppStore.getState().currentSessionId).toBe("empty-session");
  });

  it("confirms before opening a prompt-bearing template when a draft exists (#169)", async () => {
    useAppStore.setState((state: any) => ({
      ...state,
      inputStates: {
        "empty-session": {
          content: "my existing draft",
          referenceText: null,
          attachments: [],
          reasoningEffort: "medium",
        },
      },
    }));
    const chatsBefore = useAppStore.getState().chats.length;

    render(
      <AntdApp>
        <EmptyTaskLauncher sessionId="empty-session" />
      </AntdApp>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Code review" }));

    // Confirmation first — nothing happens until the user approves.
    expect(await screen.findByText("Open template in a new session?")).toBeInTheDocument();
    expect(useAppStore.getState().chats.length).toBe(chatsBefore);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => {
      expect(
        useAppStore.getState().chats.some((chat: any) => chat.id === "session-code-review"),
      ).toBe(true);
    });
    // The draft in the bound session is untouched.
    expect(useAppStore.getState().inputStates["empty-session"]?.content).toBe("my existing draft");
  });

  it("does not create a session when the draft confirmation is cancelled (#169)", async () => {
    useAppStore.setState((state: any) => ({
      ...state,
      inputStates: {
        "empty-session": {
          content: "my existing draft",
          referenceText: null,
          attachments: [],
          reasoningEffort: "medium",
        },
      },
    }));
    const chatsBefore = useAppStore.getState().chats.length;

    render(
      <AntdApp>
        <EmptyTaskLauncher sessionId="empty-session" />
      </AntdApp>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Code review" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(useAppStore.getState().chats.length).toBe(chatsBefore);
    expect(useAppStore.getState().inputStates["empty-session"]?.content).toBe("my existing draft");
  });
});
