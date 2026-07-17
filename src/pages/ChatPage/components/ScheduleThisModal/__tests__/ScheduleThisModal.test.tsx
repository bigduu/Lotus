import { App as AntdApp } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ScheduleThisModal } from "../index";
import { useAppStore } from "@shared/store/appStore";

const mockCreateSchedule = vi.fn();

vi.mock("@services/chat/AgentService", async () => {
  const actual = await vi.importActual("@services/chat/AgentService");
  return {
    ...actual,
    AgentClient: {
      getInstance: () => ({
        createSchedule: (...args: unknown[]) => mockCreateSchedule(...args),
      }),
    },
  };
});

const SESSION_ID = "sess-42";

function seedSession(
  overrides: {
    firstUserMessage?: string;
    title?: string;
    workspacePath?: string;
    model?: string;
  } = {},
) {
  const {
    firstUserMessage = "Summarize yesterday's sales numbers",
    title = "Sales summary",
    workspacePath = "/Users/me/work/sales",
    model = "gpt-4o",
  } = overrides;

  useAppStore.setState((state) => ({
    ...state,
    currentSessionId: SESSION_ID,
    chats: [
      {
        id: SESSION_ID,
        title,
        kind: "root",
        createdAt: 1710000000000,
        messages: firstUserMessage
          ? [
              {
                id: "m1",
                role: "user",
                content: firstUserMessage,
                createdAt: new Date("2026-04-05T00:00:00Z").toISOString(),
              },
            ]
          : [],
        config: {
          systemPromptId: "general_assistant",
          baseSystemPrompt: "You are helpful.",
          lastUsedEnhancedPrompt: null,
          workspacePath,
          model,
        },
      },
    ],
  }));
}

function renderModal() {
  return render(
    <AntdApp>
      <ScheduleThisModal open sessionId={SESSION_ID} onClose={vi.fn()} />
    </AntdApp>,
  );
}

describe("ScheduleThisModal (#100)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSchedule.mockResolvedValue({});
  });

  afterEach(() => {
    useAppStore.setState((state) => ({ ...state, chats: [], currentSessionId: null }));
  });

  it("prefills the task prompt, workspace, and model from the session", async () => {
    seedSession();
    renderModal();

    // Task prompt seeded from the session's first user message.
    expect(
      await screen.findByDisplayValue("Summarize yesterday's sales numbers"),
    ).toBeInTheDocument();
    // Workspace + model carried over from the session config.
    expect(screen.getByDisplayValue("/Users/me/work/sales")).toBeInTheDocument();
    expect(screen.getByDisplayValue("gpt-4o")).toBeInTheDocument();
  });

  it("falls back to the session title for the prompt when no user message is loaded", async () => {
    seedSession({ firstUserMessage: "", title: "Nightly cleanup" });
    renderModal();

    // With no user message content locally, the title seeds the task prompt.
    expect(await screen.findByDisplayValue("Nightly cleanup")).toBeInTheDocument();
  });

  it("submits a valid create-schedule request built from the prefilled fields", async () => {
    seedSession();
    renderModal();

    await screen.findByDisplayValue("Summarize yesterday's sales numbers");

    // The modal's OK button submits the create form.
    fireEvent.click(screen.getByText("Create"));

    await waitFor(() => {
      expect(mockCreateSchedule).toHaveBeenCalledTimes(1);
    });

    const payload = mockCreateSchedule.mock.calls[0][0];
    // Default trigger is a daily 09:00 run — the user only picks the schedule.
    expect(payload.trigger).toEqual({ type: "daily", hour: 9, minute: 0, second: 0 });
    expect(payload.enabled).toBe(true);
    expect(payload.run_config).toMatchObject({
      task_message: "Summarize yesterday's sales numbers",
      workspace_path: "/Users/me/work/sales",
      model: "gpt-4o",
      auto_execute: true,
    });
  });
});
