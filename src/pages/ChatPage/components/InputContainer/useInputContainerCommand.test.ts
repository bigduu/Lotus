import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandItem } from "@shared/types/command";
import { useInputContainerCommand } from "./useInputContainerCommand";

const commandService = vi.hoisted(() => ({
  listCommands: vi.fn(),
  getCommand: vi.fn(),
}));

vi.mock("../../services/CommandService", () => ({
  CommandService: {
    getInstance: () => commandService,
  },
}));

const projectWorkflow: CommandItem = {
  id: "workflow-project",
  name: "project",
  displayName: "Project workflow",
  description: "Session-scoped project workflow",
  type: "workflow",
  metadata: {},
};

describe("useInputContainerCommand session scoping", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("looks up list and detail in the active session and drops stale detail after a switch", async () => {
    let resolveSessionOneDetail: ((detail: { content: string }) => void) | undefined;
    const sessionOneDetail = new Promise<{ content: string }>((resolve) => {
      resolveSessionOneDetail = resolve;
    });
    const onWorkflowDraftChange = vi.fn();
    const setContent = vi.fn();

    commandService.listCommands.mockResolvedValue([projectWorkflow]);
    commandService.getCommand.mockImplementation(
      (_type: string, _id: string, sessionId: string) => {
        if (sessionId === "session-one") return sessionOneDetail;
        if (sessionId === "session-two") {
          return Promise.resolve({ content: "Session two workflow body" });
        }
        throw new Error(`Unexpected session: ${sessionId}`);
      },
    );

    const { result, rerender } = renderHook(
      ({ sessionId }) =>
        useInputContainerCommand({
          setContent,
          onWorkflowDraftChange,
          acknowledgeManualInput: vi.fn(),
          currentSessionId: sessionId,
          textAreaRef: { current: null },
          content: "",
        }),
      { initialProps: { sessionId: "session-one" } },
    );

    let sessionOneSelection: Promise<void> | undefined;
    await act(async () => {
      sessionOneSelection = result.current.handleCommandSelect({
        name: "project",
        type: "workflow",
        id: "workflow-project",
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(commandService.getCommand).toHaveBeenCalledWith("workflow", "project", "session-one");
    });

    rerender({ sessionId: "session-two" });

    await act(async () => {
      resolveSessionOneDetail?.({ content: "Stale session one workflow body" });
      await sessionOneSelection;
    });

    expect(result.current.selectedCommand).toBeNull();
    expect(onWorkflowDraftChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ content: "Stale session one workflow body" }),
    );

    await act(async () => {
      await result.current.handleCommandSelect({
        name: "project",
        type: "workflow",
        id: "workflow-project",
      });
    });

    expect(result.current.selectedCommand).toMatchObject({
      name: "project",
      content: "Session two workflow body",
    });
    expect(commandService.listCommands).toHaveBeenNthCalledWith(1, "session-one");
    expect(commandService.listCommands).toHaveBeenNthCalledWith(2, "session-two");
    expect(commandService.getCommand).toHaveBeenNthCalledWith(
      2,
      "workflow",
      "project",
      "session-two",
    );
  });
});
