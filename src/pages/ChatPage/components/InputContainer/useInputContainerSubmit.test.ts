import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useInputContainerSubmit } from "./useInputContainerSubmit";
import type { WorkflowDraft } from "./index";
import type { WorkspaceFileEntry } from "@shared/types/workspace";
import type { ProcessedFile } from "../../utils/fileUtils";
import { useAppStore } from "@shared/store/appStore";
import { clearUsedModels, getUsedModels } from "../../utils/usedModels";
import { WorkflowSelectionError } from "../../../../features/workflows";
import {
  finishTypedWorkflowSubmission,
  isTypedWorkflowSubmissionPending,
  resetTypedWorkflowSubmissionTrackerForTests,
  tryBeginTypedWorkflowSubmission,
} from "./typedWorkflowSubmissionTracker";

const createWorkflow = (overrides: Partial<WorkflowDraft> = {}): WorkflowDraft => ({
  id: "workflow-1",
  name: "plan",
  content: "Workflow body",
  createdAt: "2026-01-01T00:00:00.000Z",
  type: "workflow",
  ...overrides,
});

const createWorkspaceFile = (name: string, path: string): WorkspaceFileEntry => ({
  name,
  path,
  is_directory: false,
});

const createAttachment = (overrides: Partial<ProcessedFile> = {}): ProcessedFile => {
  const file = new File(["hello"], "hello.txt", { type: "text/plain" });
  return {
    id: "file-1",
    file,
    name: file.name,
    size: file.size,
    type: file.type,
    kind: "text",
    content: "hello",
    preview: "hello",
    lastModified: 0,
    ...overrides,
  };
};

const createBaseProps = () => ({
  sessionId: "session-1" as string | null,
  attachments: [] as ProcessedFile[],
  referenceText: null as string | null,
  selectedWorkflow: null as WorkflowDraft | null,
  matchesWorkflowToken: vi.fn(() => false),
  fileReferences: new Map<string, WorkspaceFileEntry>(),
  reasoningEffort: "medium" as const,
  sendMessage: vi.fn().mockResolvedValue(undefined),
  recordEntry: vi.fn(),
  clearWorkflowDraft: vi.fn(),
  clearContent: vi.fn(),
  clearReferenceText: vi.fn(),
  clearAttachments: vi.fn(),
  clearFileReferences: vi.fn(),
});

describe("useInputContainerSubmit", () => {
  afterEach(() => resetTypedWorkflowSubmissionTrackerForTests());

  it("prepends reference text when sending a message", async () => {
    const props = createBaseProps();
    props.referenceText = "> quoted message";
    props.reasoningEffort = "high";

    const { result } = renderHook(() =>
      useInputContainerSubmit({
        ...props,
      }),
    );

    await act(async () => {
      await result.current.handleSubmit("my reply");
    });

    expect(props.recordEntry).toHaveBeenCalledWith("> quoted message\n\nmy reply");
    expect(props.sendMessage).toHaveBeenCalledWith(
      "> quoted message\n\nmy reply",
      undefined,
      "high",
      undefined,
    );
    expect(props.clearReferenceText).toHaveBeenCalledWith("> quoted message");
    expect(props.clearContent).toHaveBeenCalledWith("my reply");
    expect(props.clearWorkflowDraft).toHaveBeenCalledWith(null);
    expect(props.clearAttachments).toHaveBeenCalledWith([]);
    expect(props.clearFileReferences).toHaveBeenCalledWith([]);
  });

  it("keeps original behavior when no reference text is set", async () => {
    const props = createBaseProps();

    const { result } = renderHook(() =>
      useInputContainerSubmit({
        ...props,
      }),
    );

    await act(async () => {
      await result.current.handleSubmit("plain reply");
    });

    expect(props.recordEntry).toHaveBeenCalledWith("plain reply");
    expect(props.sendMessage).toHaveBeenCalledWith("plain reply", undefined, "medium", undefined);
  });

  it("returns early for empty message with no attachments and no images", async () => {
    const props = createBaseProps();
    const { result } = renderHook(() => useInputContainerSubmit({ ...props }));

    await act(async () => {
      await result.current.handleSubmit("   ");
    });

    expect(props.recordEntry).not.toHaveBeenCalled();
    expect(props.sendMessage).not.toHaveBeenCalled();
    expect(props.clearContent).not.toHaveBeenCalled();
    expect(props.clearReferenceText).not.toHaveBeenCalled();
  });

  it("sends message when images are present even if text is empty", async () => {
    const props = createBaseProps();
    const { result } = renderHook(() => useInputContainerSubmit({ ...props }));
    const imageFile = {
      id: "img-1",
      name: "img.png",
      type: "image/png",
      size: 1,
      base64: "data:image/png;base64,abc",
      preview: "blob:img",
      file: new File(["a"], "img.png", { type: "image/png" }),
    };

    await act(async () => {
      await result.current.handleSubmit("  ", [imageFile]);
    });

    expect(props.sendMessage).toHaveBeenCalledWith("", [imageFile], "medium", undefined);
  });

  it("adds workflow content when workflow token is matched", async () => {
    const props = createBaseProps();
    props.selectedWorkflow = createWorkflow({
      name: "review",
      content: "Review workflow body",
      type: "workflow",
    });
    props.matchesWorkflowToken = vi.fn(() => true);
    const { result } = renderHook(() => useInputContainerSubmit({ ...props }));

    await act(async () => {
      await result.current.handleSubmit("/review fix this");
    });

    expect(props.sendMessage).toHaveBeenCalledWith(
      "Review workflow body\n\nfix this",
      undefined,
      "medium",
      undefined,
    );
  });

  it("sends a typed instruction identity and args without expanding body or hint text", async () => {
    const props = createBaseProps();
    props.selectedWorkflow = createWorkflow({
      type: "skill",
      name: "review",
      displayName: "Review",
      content: "PRIVATE EXPANDED BODY",
      workflowSelection: {
        id: "review",
        source: "project",
        revision: 12,
        args: { scope: "src" },
      },
      workflowArgumentsText: '{"scope":"src"}',
      workflowArgumentsError: null,
    });
    props.matchesWorkflowToken = vi.fn(() => true);
    const { result } = renderHook(() => useInputContainerSubmit({ ...props }));

    let accepted = false;
    await act(async () => {
      accepted = await result.current.handleSubmit("/review inspect this change");
    });

    expect(accepted).toBe(true);
    expect(props.sendMessage).toHaveBeenCalledWith(
      "inspect this change",
      undefined,
      "medium",
      undefined,
      {
        id: "review",
        source: "project",
        revision: 12,
        args: { scope: "src" },
      },
    );
    expect(JSON.stringify(props.sendMessage.mock.calls)).not.toContain("PRIVATE EXPANDED BODY");
    expect(JSON.stringify(props.sendMessage.mock.calls)).not.toContain("User explicitly selected");
  });

  it("coalesces concurrent typed submissions until Bamboo accepts the first chat", async () => {
    const props = createBaseProps();
    props.selectedWorkflow = createWorkflow({
      type: "skill",
      name: "review",
      content: "",
      workflowSelection: { id: "review", source: "project", revision: 12, args: {} },
      workflowArgumentsText: "{}",
      workflowArgumentsError: null,
    });
    props.matchesWorkflowToken = vi.fn(() => true);

    let resolveFirstSend: (() => void) | undefined;
    props.sendMessage.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirstSend = resolve;
        }),
    );

    const { result } = renderHook(() => useInputContainerSubmit({ ...props }));
    let firstSubmission!: Promise<boolean>;
    let duplicateSubmission!: Promise<boolean>;

    act(() => {
      firstSubmission = result.current.handleSubmit("/review inspect this change");
      duplicateSubmission = result.current.handleSubmit("/review inspect this change");
    });

    expect(props.sendMessage).toHaveBeenCalledTimes(1);
    expect(isTypedWorkflowSubmissionPending("session-1")).toBe(true);
    expect(props.clearContent).not.toHaveBeenCalled();
    expect(props.clearWorkflowDraft).not.toHaveBeenCalled();

    await act(async () => {
      resolveFirstSend?.();
      await expect(Promise.all([firstSubmission, duplicateSubmission])).resolves.toEqual([
        true,
        false,
      ]);
    });

    expect(props.sendMessage).toHaveBeenCalledTimes(1);
    expect(props.clearWorkflowDraft).toHaveBeenCalledTimes(1);
    expect(isTypedWorkflowSubmissionPending("session-1")).toBe(false);

    await act(async () => {
      await result.current.handleSubmit("/review inspect again");
    });

    expect(props.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("blocks every session send while a typed submission is pending even without a local draft", async () => {
    const revision = tryBeginTypedWorkflowSubmission("session-1");
    expect(revision).not.toBeNull();
    const props = createBaseProps();
    props.selectedWorkflow = null;
    const { result } = renderHook(() => useInputContainerSubmit({ ...props }));

    await act(async () => {
      await expect(result.current.handleSubmit("external follow-up")).resolves.toBe(false);
    });
    expect(props.sendMessage).not.toHaveBeenCalled();

    expect(finishTypedWorkflowSubmission("session-1", revision!)).toBe(true);
    await act(async () => {
      await expect(result.current.handleSubmit("external follow-up")).resolves.toBe(true);
    });
    expect(props.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("keeps the typed fence when a pending session composer remounts", async () => {
    const firstProps = createBaseProps();
    firstProps.selectedWorkflow = createWorkflow({
      type: "skill",
      name: "review",
      content: "",
      workflowSelection: { id: "review", source: "project", revision: 12, args: {} },
      workflowArgumentsText: "{}",
      workflowArgumentsError: null,
    });
    firstProps.matchesWorkflowToken = vi.fn(() => true);
    let resolveFirstSend: (() => void) | undefined;
    firstProps.sendMessage.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirstSend = resolve;
        }),
    );

    const firstHook = renderHook(() => useInputContainerSubmit({ ...firstProps }));
    let firstSubmission!: Promise<boolean>;
    act(() => {
      firstSubmission = firstHook.result.current.handleSubmit("/review inspect once");
    });
    expect(isTypedWorkflowSubmissionPending("session-1")).toBe(true);
    firstHook.unmount();

    const remountedProps = createBaseProps();
    remountedProps.selectedWorkflow = firstProps.selectedWorkflow;
    remountedProps.matchesWorkflowToken = vi.fn(() => true);
    const remountedHook = renderHook(() => useInputContainerSubmit({ ...remountedProps }));

    await act(async () => {
      await expect(
        remountedHook.result.current.handleSubmit("/review inspect twice"),
      ).resolves.toBe(false);
    });
    expect(remountedProps.sendMessage).not.toHaveBeenCalled();

    await act(async () => {
      resolveFirstSend?.();
      await firstSubmission;
    });
    expect(isTypedWorkflowSubmissionPending("session-1")).toBe(false);
  });

  it("cleans only the originating session snapshot after a pane switches sessions", async () => {
    const oldSessionProps = createBaseProps();
    oldSessionProps.selectedWorkflow = createWorkflow({
      type: "skill",
      name: "review",
      content: "",
      workflowSelection: { id: "review", source: "project", revision: 12, args: {} },
      workflowArgumentsText: "{}",
      workflowArgumentsError: null,
    });
    oldSessionProps.matchesWorkflowToken = vi.fn(() => true);
    let resolveOldSend: (() => void) | undefined;
    oldSessionProps.sendMessage.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveOldSend = resolve;
        }),
    );
    const newSessionProps = {
      ...createBaseProps(),
      sessionId: "session-2",
      clearWorkflowDraft: vi.fn(),
      clearAttachments: vi.fn(),
      clearFileReferences: vi.fn(),
    };

    const { result, rerender } = renderHook(({ props }) => useInputContainerSubmit({ ...props }), {
      initialProps: { props: oldSessionProps },
    });
    let oldSubmission!: Promise<boolean>;
    act(() => {
      oldSubmission = result.current.handleSubmit("/review old session");
    });

    rerender({ props: newSessionProps });
    await act(async () => {
      resolveOldSend?.();
      await oldSubmission;
    });

    expect(oldSessionProps.clearContent).toHaveBeenCalledWith("/review old session");
    expect(oldSessionProps.clearReferenceText).toHaveBeenCalledWith(null);
    expect(oldSessionProps.clearWorkflowDraft).toHaveBeenCalledWith(
      oldSessionProps.selectedWorkflow,
    );
    expect(oldSessionProps.clearAttachments).toHaveBeenCalledWith([]);
    expect(oldSessionProps.clearFileReferences).toHaveBeenCalledWith([]);
    expect(newSessionProps.clearWorkflowDraft).not.toHaveBeenCalled();
    expect(newSessionProps.clearAttachments).not.toHaveBeenCalled();
    expect(newSessionProps.clearFileReferences).not.toHaveBeenCalled();
    expect(isTypedWorkflowSubmissionPending("session-1")).toBe(false);
  });

  it("preserves composer state and selection after a recoverable stale revision", async () => {
    const props = createBaseProps();
    const onWorkflowSelectionError = vi.fn();
    props.selectedWorkflow = createWorkflow({
      type: "skill",
      name: "review",
      content: "",
      workflowSelection: { id: "review", source: "project", revision: 12, args: {} },
      workflowArgumentsText: "{}",
      workflowArgumentsError: null,
    });
    props.matchesWorkflowToken = vi.fn(() => true);
    props.sendMessage.mockRejectedValue(
      new WorkflowSelectionError(
        "workflow_revision_mismatch",
        "Refresh and reselect the Workflow.",
        true,
        409,
      ),
    );
    const { result } = renderHook(() =>
      useInputContainerSubmit({ ...props, onWorkflowSelectionError }),
    );

    let accepted = true;
    await act(async () => {
      accepted = await result.current.handleSubmit("/review keep this draft");
    });

    expect(accepted).toBe(false);
    expect(onWorkflowSelectionError).toHaveBeenCalledWith(
      "Refresh and reselect the Workflow.",
      props.selectedWorkflow,
    );
    expect(props.clearContent).not.toHaveBeenCalled();
    expect(props.clearWorkflowDraft).not.toHaveBeenCalled();
    expect(props.clearReferenceText).not.toHaveBeenCalled();
    expect(props.clearAttachments).not.toHaveBeenCalled();
    expect(props.recordEntry).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.handleSubmit("/review keep this draft");
    });

    expect(props.sendMessage).toHaveBeenCalledTimes(2);
    expect(onWorkflowSelectionError).toHaveBeenCalledTimes(2);
  });

  it("does not send invalid typed arguments and keeps the draft", async () => {
    const props = createBaseProps();
    const onWorkflowSelectionError = vi.fn();
    props.selectedWorkflow = createWorkflow({
      type: "skill",
      name: "review",
      content: "",
      workflowSelection: { id: "review", source: "project", revision: 12, args: {} },
      workflowArgumentsText: "{",
      workflowArgumentsError: "Workflow arguments must be valid JSON.",
    });
    props.matchesWorkflowToken = vi.fn(() => true);
    const { result } = renderHook(() =>
      useInputContainerSubmit({ ...props, onWorkflowSelectionError }),
    );

    let accepted = true;
    await act(async () => {
      accepted = await result.current.handleSubmit("/review keep this too");
    });

    expect(accepted).toBe(false);
    expect(props.sendMessage).not.toHaveBeenCalled();
    expect(props.clearContent).not.toHaveBeenCalled();
    expect(onWorkflowSelectionError).toHaveBeenCalledWith(
      "Workflow arguments must be valid JSON.",
      props.selectedWorkflow,
    );
  });

  it("keeps original input when workflow token is not matched", async () => {
    const props = createBaseProps();
    props.selectedWorkflow = createWorkflow({
      name: "review",
      content: "Review workflow body",
      type: "workflow",
    });
    props.matchesWorkflowToken = vi.fn(() => false);
    const { result } = renderHook(() => useInputContainerSubmit({ ...props }));

    await act(async () => {
      await result.current.handleSubmit("/review fix this");
    });

    expect(props.sendMessage).toHaveBeenCalledWith(
      "/review fix this",
      undefined,
      "medium",
      undefined,
    );
  });

  it("injects selected skill hint and forwards selectedSkillIds", async () => {
    const props = createBaseProps();
    props.selectedWorkflow = createWorkflow({
      type: "skill",
      name: "debug_skill",
      displayName: "Debug Skill",
      content: "",
    });
    props.matchesWorkflowToken = vi.fn(() => true);
    const { result } = renderHook(() => useInputContainerSubmit({ ...props }));

    await act(async () => {
      await result.current.handleSubmit("/debug_skill investigate");
    });

    expect(props.sendMessage).toHaveBeenCalledWith(
      "[User explicitly selected skill: Debug Skill (ID: debug_skill)]\n\ninvestigate",
      undefined,
      "medium",
      ["debug_skill"],
    );
  });

  it("injects MCP hint using alias when MCP token is matched", async () => {
    const props = createBaseProps();
    props.selectedWorkflow = createWorkflow({
      type: "mcp",
      name: "read_file",
      displayName: "Read File",
      mcpAlias: "mcp__filesystem__read_file",
      content: "",
    });
    props.matchesWorkflowToken = vi.fn(() => true);
    const { result } = renderHook(() => useInputContainerSubmit({ ...props }));

    await act(async () => {
      await result.current.handleSubmit("/read_file src/main.ts");
    });

    expect(props.sendMessage).toHaveBeenCalledWith(
      "[User explicitly selected MCP tool: mcp__filesystem__read_file]\n\nsrc/main.ts",
      undefined,
      "medium",
      undefined,
    );
  });

  it("sends structured file reference payload when referenced files are found", async () => {
    const props = createBaseProps();
    props.fileReferences = new Map([
      ["core.md", createWorkspaceFile("core.md", "/project/docs/core.md")],
    ]);
    const { result } = renderHook(() => useInputContainerSubmit({ ...props }));

    await act(async () => {
      await result.current.handleSubmit("please inspect @core.md");
    });

    expect(props.sendMessage).toHaveBeenCalledTimes(1);
    const structured = props.sendMessage.mock.calls[0][0] as string;
    expect(JSON.parse(structured)).toEqual({
      type: "file_reference",
      paths: ["/project/docs/core.md"],
      display_text: "please inspect @core.md",
    });
  });

  it("falls back to plain message when @mention has no mapped file entry", async () => {
    const props = createBaseProps();
    props.fileReferences = new Map([
      ["other.ts", createWorkspaceFile("other.ts", "/project/src/other.ts")],
    ]);
    const { result } = renderHook(() => useInputContainerSubmit({ ...props }));

    await act(async () => {
      await result.current.handleSubmit("please inspect @main.ts");
    });

    expect(props.sendMessage).toHaveBeenCalledWith(
      "please inspect @main.ts",
      undefined,
      "medium",
      undefined,
    );
  });

  it("falls back to plain message when file references exist but no @mention is present", async () => {
    const props = createBaseProps();
    props.fileReferences = new Map([
      ["main.ts", createWorkspaceFile("main.ts", "/project/src/main.ts")],
    ]);
    const { result } = renderHook(() => useInputContainerSubmit({ ...props }));

    await act(async () => {
      await result.current.handleSubmit("plain message");
    });

    expect(props.sendMessage).toHaveBeenCalledWith("plain message", undefined, "medium", undefined);
  });

  it("sends attachment summary when message is empty but attachments exist", async () => {
    const props = createBaseProps();
    props.attachments = [createAttachment()];
    const { result } = renderHook(() => useInputContainerSubmit({ ...props }));

    await act(async () => {
      await result.current.handleSubmit("   ");
    });

    expect(props.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining("### File: hello.txt"),
      undefined,
      "medium",
      undefined,
    );
    expect(props.clearAttachments).toHaveBeenCalledWith(["file-1"]);
  });

  it("records the selected model as used on submit (select + use → discovery)", async () => {
    clearUsedModels();
    act(() => {
      useAppStore.getState().setSelectedModel("gpt-4o");
    });

    const props = createBaseProps();
    const { result } = renderHook(() => useInputContainerSubmit({ ...props }));

    await act(async () => {
      await result.current.handleSubmit("hello there");
    });

    expect(props.sendMessage).toHaveBeenCalled();
    expect(getUsedModels()).toContain("gpt-4o");
  });

  it("records the resolved session model (usedModelName) over the stale global selection", async () => {
    // Repro: global selectedModel is a stale default, but the session actually
    // uses glm-5.1 — we must record glm-5.1, not the default.
    clearUsedModels();
    act(() => {
      useAppStore.getState().setSelectedModel("claude-haiku-4-5-20251001");
    });

    const props = { ...createBaseProps(), usedModelName: "glm-5.1" };
    const { result } = renderHook(() => useInputContainerSubmit(props));

    await act(async () => {
      await result.current.handleSubmit("hi");
    });

    expect(getUsedModels()).toEqual(["glm-5.1"]);
  });

  it("does not record anything when no message is sent", async () => {
    clearUsedModels();
    act(() => {
      useAppStore.getState().setSelectedModel("gpt-4o");
    });

    const props = createBaseProps();
    const { result } = renderHook(() => useInputContainerSubmit({ ...props }));

    // Empty input with no attachments/images returns early before recording.
    await act(async () => {
      await result.current.handleSubmit("   ");
    });

    expect(props.sendMessage).not.toHaveBeenCalled();
    expect(getUsedModels()).toEqual([]);
  });
});
