import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useInputContainerSubmit } from "./useInputContainerSubmit";
import type { WorkflowDraft } from "./index";
import type { WorkspaceFileEntry } from "../../types/workspace";
import type { ProcessedFile } from "../../utils/fileUtils";
import { useAppStore } from "../../store";
import { clearUsedModels, getUsedModels } from "../../utils/usedModels";

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
  attachments: [] as ProcessedFile[],
  referenceText: null as string | null,
  selectedWorkflow: null as WorkflowDraft | null,
  matchesWorkflowToken: vi.fn(() => false),
  fileReferences: new Map<string, WorkspaceFileEntry>(),
  reasoningEffort: "medium" as const,
  sendMessage: vi.fn().mockResolvedValue(undefined),
  recordEntry: vi.fn(),
  clearWorkflowDraft: vi.fn(),
  setContent: vi.fn(),
  setReferenceText: vi.fn(),
  setAttachments: vi.fn(),
  setFileReferences: vi.fn(),
});

describe("useInputContainerSubmit", () => {
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
    expect(props.setReferenceText).toHaveBeenCalledWith(null);
    expect(props.setContent).toHaveBeenCalledWith("");
    expect(props.clearWorkflowDraft).toHaveBeenCalled();
    expect(props.setAttachments).toHaveBeenCalledWith([]);
    expect(props.setFileReferences).toHaveBeenCalledWith(new Map());
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
    expect(props.setContent).not.toHaveBeenCalled();
    expect(props.setReferenceText).not.toHaveBeenCalled();
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
