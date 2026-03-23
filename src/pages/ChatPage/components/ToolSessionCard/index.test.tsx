import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ToolSessionCard, { type ToolSessionItem } from ".";

const buildToolItem = (): ToolSessionItem => ({
  call: {
    id: "assistant-msg-1:call-1",
    role: "assistant",
    type: "tool_call",
    createdAt: "2026-03-22T11:29:10.131388Z",
    toolCalls: [
      {
        toolCallId: "call-1",
        toolName: "write",
        parameters: { file_path: "/tmp/demo.ts" },
        streamingOutput: "",
      },
    ],
  },
  result: {
    id: "tool-msg-1",
    role: "assistant",
    type: "tool_result",
    createdAt: "2026-03-22T11:29:10.231388Z",
    toolName: "write",
    toolCallId: "call-1",
    isError: false,
    result: {
      tool_name: "write",
      result: "ok",
      display_preference: "Default",
    },
  },
  callMessageId: "assistant-msg-1",
  resultMessageId: "tool-msg-1",
});

describe("ToolSessionCard", () => {
  it("deletes persisted tool call/result messages", () => {
    const onDeleteMessageIds = vi.fn();

    render(
      <ToolSessionCard
        tools={[buildToolItem()]}
        sessionId="session-1"
        createdAt="2026-03-22T11:29:10.131388Z"
        onDeleteMessageIds={onDeleteMessageIds}
      />,
    );

    fireEvent.click(screen.getByTestId("delete-tool-message-call-1"));

    expect(onDeleteMessageIds).toHaveBeenCalledTimes(1);
    expect(onDeleteMessageIds).toHaveBeenCalledWith([
      "assistant-msg-1",
      "tool-msg-1",
    ]);
  });

  it("disables delete when no persisted message id is available", () => {
    const onDeleteMessageIds = vi.fn();

    render(
      <ToolSessionCard
        tools={[
          {
            call: {
              id: "synthetic-tool-call:orphan-result",
              role: "assistant",
              type: "tool_call",
              createdAt: "2026-03-22T11:31:49.321433Z",
              toolCalls: [
                {
                  toolCallId: "call-2",
                  toolName: "unknown",
                  parameters: {},
                },
              ],
            },
          },
        ]}
        sessionId="session-2"
        createdAt="2026-03-22T11:31:49.321433Z"
        onDeleteMessageIds={onDeleteMessageIds}
      />,
    );

    const button = screen.getByTestId(
      "delete-tool-message-call-2",
    ) as HTMLButtonElement;
    expect(button).toBeDisabled();

    fireEvent.click(button);
    expect(onDeleteMessageIds).not.toHaveBeenCalled();
  });
});

