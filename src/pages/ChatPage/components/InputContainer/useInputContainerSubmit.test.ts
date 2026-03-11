import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useInputContainerSubmit } from "./useInputContainerSubmit";

describe("useInputContainerSubmit", () => {
  it("prepends reference text when sending a message", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const recordEntry = vi.fn();
    const clearWorkflowDraft = vi.fn();
    const setContent = vi.fn();
    const setReferenceText = vi.fn();
    const setAttachments = vi.fn();
    const setFileReferences = vi.fn();

    const { result } = renderHook(() =>
      useInputContainerSubmit({
        attachments: [],
        referenceText: "> quoted message",
        selectedWorkflow: null,
        matchesWorkflowToken: vi.fn(() => false),
        fileReferences: new Map(),
        sendMessage,
        recordEntry,
        clearWorkflowDraft,
        setContent,
        setReferenceText,
        setAttachments,
        setFileReferences,
      }),
    );

    await act(async () => {
      await result.current.handleSubmit("my reply");
    });

    expect(recordEntry).toHaveBeenCalledWith("> quoted message\n\nmy reply");
    expect(sendMessage).toHaveBeenCalledWith(
      "> quoted message\n\nmy reply",
      undefined,
    );
    expect(setReferenceText).toHaveBeenCalledWith(null);
    expect(setContent).toHaveBeenCalledWith("");
    expect(clearWorkflowDraft).toHaveBeenCalled();
    expect(setAttachments).toHaveBeenCalledWith([]);
    expect(setFileReferences).toHaveBeenCalledWith(new Map());
  });

  it("keeps original behavior when no reference text is set", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const recordEntry = vi.fn();

    const { result } = renderHook(() =>
      useInputContainerSubmit({
        attachments: [],
        referenceText: null,
        selectedWorkflow: null,
        matchesWorkflowToken: vi.fn(() => false),
        fileReferences: new Map(),
        sendMessage,
        recordEntry,
        clearWorkflowDraft: vi.fn(),
        setContent: vi.fn(),
        setReferenceText: vi.fn(),
        setAttachments: vi.fn(),
        setFileReferences: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleSubmit("plain reply");
    });

    expect(recordEntry).toHaveBeenCalledWith("plain reply");
    expect(sendMessage).toHaveBeenCalledWith("plain reply", undefined);
  });
});
