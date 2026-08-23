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
      sessionOneSelection = result.current.handleCommandSelect(projectWorkflow);
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
      await result.current.handleCommandSelect(projectWorkflow);
    });

    expect(result.current.selectedCommand).toMatchObject({
      name: "project",
      content: "Session two workflow body",
    });
    expect(commandService.listCommands).not.toHaveBeenCalled();
    expect(commandService.getCommand).toHaveBeenNthCalledWith(
      2,
      "workflow",
      "project",
      "session-two",
    );
  });

  it("creates a typed instruction selection without loading or retaining its body", async () => {
    const onWorkflowDraftChange = vi.fn();
    const typedInstruction: CommandItem = {
      id: "workflow-catalog:review",
      name: "review",
      displayName: "Review safely",
      description: "Review a scoped change",
      type: "skill",
      metadata: {
        workflowCatalog: true,
        workflowKind: "instruction",
        workflowSource: "project",
        workflowStatus: "valid",
        workflowInvocationPolicy: "manual",
        workflowRevision: 12,
        workflowVersion: "4",
        workflowArgumentHint: "<scope>",
        workflowArgumentSchema: {
          type: "object",
          properties: { scope: { type: "string", default: "src" } },
          required: ["scope"],
          additionalProperties: false,
        },
        workflowSelectable: true,
        workflowTypedActivation: true,
      },
    };

    const { result } = renderHook(() =>
      useInputContainerCommand({
        setContent: vi.fn(),
        onWorkflowDraftChange,
        acknowledgeManualInput: vi.fn(),
        currentSessionId: "session-one",
        textAreaRef: { current: null },
        content: "/rev",
      }),
    );

    await act(async () => {
      await result.current.handleCommandSelect(typedInstruction);
    });

    expect(commandService.getCommand).not.toHaveBeenCalled();
    expect(commandService.listCommands).not.toHaveBeenCalled();
    expect(result.current.selectedCommand).toMatchObject({
      name: "review",
      content: "",
      workflowSelection: {
        id: "review",
        source: "project",
        revision: 12,
        args: { scope: "src" },
      },
    });
    expect(JSON.stringify(result.current.selectedCommand)).not.toContain("PRIVATE");

    act(() => result.current.updateWorkflowArguments('{"scope":42}'));
    expect(result.current.selectedCommand?.workflowArgumentsError).toContain("must be string");
    expect(result.current.selectedCommand?.workflowSelection?.args).toEqual({ scope: "src" });

    act(() => result.current.updateWorkflowArguments('{"scope":"tests"}'));
    expect(result.current.selectedCommand?.workflowArgumentsError).toBeNull();
    expect(result.current.selectedCommand?.workflowSelection?.args).toEqual({ scope: "tests" });
  });

  it("replaces a refreshed typed identity without duplicating the preserved command text", async () => {
    const setContent = vi.fn();
    const typedInstruction: CommandItem = {
      id: "workflow-catalog:review:12",
      name: "review",
      displayName: "Review safely",
      description: "Review a scoped change",
      type: "skill",
      metadata: {
        workflowCatalog: true,
        workflowKind: "instruction",
        workflowSource: "project",
        workflowStatus: "valid",
        workflowInvocationPolicy: "manual",
        workflowRevision: 12,
        workflowSelectable: true,
        workflowTypedActivation: true,
      },
    };
    const { result, rerender } = renderHook(
      ({ content }) =>
        useInputContainerCommand({
          setContent,
          acknowledgeManualInput: vi.fn(),
          currentSessionId: "session-one",
          textAreaRef: { current: null },
          content,
        }),
      { initialProps: { content: "/rev" } },
    );

    await act(async () => result.current.handleCommandSelect(typedInstruction));
    act(() => result.current.updateWorkflowArguments('{"scope":"tests"}'));
    rerender({ content: "/review keep this draft" });
    act(() => result.current.reselectWorkflow());
    expect(result.current.selectedCommand?.workflowSelection?.revision).toBe(12);

    await act(async () =>
      result.current.handleCommandSelect({
        ...typedInstruction,
        id: "workflow-catalog:review:13",
        metadata: { ...typedInstruction.metadata, workflowRevision: 13 },
      }),
    );

    expect(setContent).toHaveBeenLastCalledWith("/review keep this draft");
    expect(result.current.selectedCommand?.workflowSelection?.revision).toBe(13);
    expect(result.current.selectedCommand?.workflowSelection?.args).toEqual({ scope: "tests" });
    expect(result.current.selectedCommand?.workflowArgumentsText).toBe('{"scope":"tests"}');
  });
});
