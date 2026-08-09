import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearAssistantStreamingState,
  getAssistantStreamingState,
  setAssistantStreamingState,
} from "../../../streaming/assistantStreamingAtoms";
import {
  clearToolStreamingState,
  getToolStreamingState,
} from "../../../streaming/toolStreamingAtoms";
import { streamingMessageBus } from "../../../utils/streamingMessageBus";
import type { RunContext, StreamingDraftState } from "../../subscriptionContext";
import { createToolHandlers } from "../toolHandlers";

const { mockStoreState } = vi.hoisted(() => ({
  mockStoreState: {
    chats: [] as Array<{
      id: string;
      messages: Array<Record<string, unknown>>;
    }>,
  },
}));

vi.mock("@shared/store/appStore", () => ({
  useAppStore: { getState: () => mockStoreState },
}));

const SESSION_ID = "session-tools";
const TOOL_CALL_IDS = ["call-1", "call-recovered", "call-orphan", "call-error"];

function makeDraft(patch: Partial<StreamingDraftState> = {}): StreamingDraftState {
  return {
    sessionId: SESSION_ID,
    messageId: `streaming-${SESSION_ID}`,
    content: "",
    reasoningMessageId: `streaming-reasoning-${SESSION_ID}`,
    reasoningContent: "",
    statusMessageId: `streaming-status-${SESSION_ID}`,
    status: "",
    ...patch,
  };
}

function makeRun(draft = makeDraft()) {
  const addMessage = vi.fn().mockResolvedValue(undefined);
  const applyAgentEvent = vi.fn();
  const updateMessage = vi.fn().mockResolvedValue(undefined);
  const toolNamesByCallIdRef = { current: new Map<string, string>() };
  const toolCallMessageIdByCallIdRef = { current: new Map<string, string>() };
  const setStreamingStatus = vi.fn((nextStatus?: string | null) => {
    draft.status = (nextStatus ?? "").trim();
  });
  const run = {
    ctx: {
      addMessage,
      applyAgentEvent,
      updateMessage,
      streamingStateBySessionRef: {
        current: new Map([[SESSION_ID, draft]]),
      },
      toolNamesByCallIdRef,
      toolCallMessageIdByCallIdRef,
    },
    sessionId: SESSION_ID,
    generation: 4,
    controller: new AbortController(),
    messageId: draft.messageId,
    reasoningMessageId: draft.reasoningMessageId,
    statusMessageId: draft.statusMessageId,
    setStreamingStatus,
    scheduleParentSettleCheck: vi.fn(),
  } as unknown as RunContext;

  return {
    run,
    addMessage,
    applyAgentEvent,
    updateMessage,
    setStreamingStatus,
    toolNamesByCallIdRef,
    toolCallMessageIdByCallIdRef,
  };
}

describe("createToolHandlers", () => {
  beforeEach(() => {
    mockStoreState.chats = [];
    clearAssistantStreamingState(SESSION_ID);
    TOOL_CALL_IDS.forEach((toolCallId) => clearToolStreamingState(SESSION_ID, toolCallId));
  });

  afterEach(() => {
    clearAssistantStreamingState(SESSION_ID);
    TOOL_CALL_IDS.forEach((toolCallId) => clearToolStreamingState(SESSION_ID, toolCallId));
    vi.restoreAllMocks();
  });

  it("flushes a buffered assistant draft before adding and tracking the tool call", () => {
    const draft = makeDraft({
      content: "I will inspect the file.",
      reasoningContent: "Need the latest contents.",
      status: "thinking",
    });
    setAssistantStreamingState(SESSION_ID, {
      content: draft.content,
      reasoningContent: draft.reasoningContent,
    });
    const clearBus = vi.spyOn(streamingMessageBus, "clear");
    const {
      run,
      addMessage,
      applyAgentEvent,
      setStreamingStatus,
      toolNamesByCallIdRef,
      toolCallMessageIdByCallIdRef,
    } = makeRun(draft);

    createToolHandlers(run).onToolStart?.("call-1", "Read", { path: "README.md" });

    expect(applyAgentEvent).toHaveBeenCalledWith(
      SESSION_ID,
      { type: "tool_start", tool_call_id: "call-1", tool_name: "Read" },
      4,
    );
    expect(addMessage).toHaveBeenNthCalledWith(
      1,
      SESSION_ID,
      expect.objectContaining({
        role: "assistant",
        type: "text",
        content: "I will inspect the file.",
        metadata: expect.objectContaining({ reasoning: "Need the latest contents." }),
      }),
    );
    expect(addMessage).toHaveBeenNthCalledWith(
      2,
      SESSION_ID,
      expect.objectContaining({
        role: "assistant",
        type: "tool_call",
        toolCalls: [
          expect.objectContaining({
            toolCallId: "call-1",
            toolName: "Read",
            parameters: { path: "README.md" },
          }),
        ],
      }),
    );
    expect(getAssistantStreamingState(SESSION_ID)).toMatchObject({
      content: "",
      reasoningContent: "",
    });
    expect(clearBus).toHaveBeenCalledWith(SESSION_ID, draft.statusMessageId);
    expect(setStreamingStatus).toHaveBeenLastCalledWith("tool_running:read");
    expect(toolNamesByCallIdRef.current.get("call-1")).toBe("Read");
    expect(toolCallMessageIdByCallIdRef.current.get("call-1")).toEqual(expect.any(String));
  });

  it("pairs start, streamed output and completion while cleaning correlation refs", () => {
    const draft = makeDraft();
    const {
      run,
      addMessage,
      applyAgentEvent,
      setStreamingStatus,
      toolNamesByCallIdRef,
      toolCallMessageIdByCallIdRef,
    } = makeRun(draft);
    const handlers = createToolHandlers(run);

    handlers.onToolStart?.("call-1", "Shell", { command: "pwd" });
    handlers.onToolToken?.("call-1", "/workspace");
    expect(getToolStreamingState(SESSION_ID, "call-1")).toMatchObject({
      output: "/workspace",
      status: "running",
    });

    handlers.onToolComplete?.("call-1", {
      success: true,
      result: "/workspace",
      display_preference: "Collapsible",
      images: [{ mime_type: "image/png", data: "aW1hZ2U=" }],
    });

    expect(applyAgentEvent).toHaveBeenNthCalledWith(
      2,
      SESSION_ID,
      { type: "tool_token", tool_call_id: "call-1", content: "/workspace" },
      4,
    );
    expect(applyAgentEvent).toHaveBeenNthCalledWith(
      3,
      SESSION_ID,
      { type: "tool_complete", tool_call_id: "call-1" },
      4,
    );
    expect(getToolStreamingState(SESSION_ID, "call-1")).toMatchObject({
      output: "/workspace",
      status: "completed",
    });
    expect(addMessage).toHaveBeenLastCalledWith(
      SESSION_ID,
      expect.objectContaining({
        role: "assistant",
        type: "tool_result",
        toolName: "Shell",
        toolCallId: "call-1",
        result: {
          tool_name: "Shell",
          result: "/workspace",
          display_preference: "Collapsible",
        },
        isError: false,
        images: [expect.objectContaining({ url: "data:image/png;base64,aW1hZ2U=" })],
      }),
    );
    expect(toolNamesByCallIdRef.current.has("call-1")).toBe(false);
    expect(toolCallMessageIdByCallIdRef.current.has("call-1")).toBe(false);
    expect(setStreamingStatus).toHaveBeenLastCalledWith(null);
  });

  it("recovers a call from stored messages before applying tokens and lifecycle metadata", () => {
    mockStoreState.chats = [
      {
        id: SESSION_ID,
        messages: [
          {
            id: "stored-call-message",
            role: "assistant",
            type: "tool_call",
            metadata: { source: "history" },
            toolCalls: [
              {
                toolCallId: "call-recovered",
                toolName: "Bash",
                parameters: { command: "npm test" },
              },
            ],
          },
        ],
      },
    ];
    const draft = makeDraft({ status: "tool_running:bash" });
    const { run, addMessage, updateMessage, toolNamesByCallIdRef, toolCallMessageIdByCallIdRef } =
      makeRun(draft);
    const handlers = createToolHandlers(run);

    handlers.onToolToken?.("call-recovered", "passing");
    expect(toolNamesByCallIdRef.current.get("call-recovered")).toBe("Bash");
    expect(toolCallMessageIdByCallIdRef.current.get("call-recovered")).toBe("stored-call-message");

    handlers.onToolLifecycle?.(
      "call-recovered",
      "Bash",
      "finished",
      1250,
      true,
      true,
      "Tests passed",
    );
    expect(updateMessage).toHaveBeenCalledWith(SESSION_ID, "stored-call-message", {
      metadata: {
        source: "history",
        elapsed_ms: 1250,
        is_mutating: true,
        summary: "Tests passed",
      },
    });
    expect(getToolStreamingState(SESSION_ID, "call-recovered").status).toBe("completed");

    handlers.onToolComplete?.("call-recovered", { success: true, result: "passing" });
    expect(addMessage).toHaveBeenLastCalledWith(
      SESSION_ID,
      expect.objectContaining({
        type: "tool_result",
        toolName: "Bash",
        toolCallId: "call-recovered",
      }),
    );
  });

  it("records a safe unknown result when completion arrives without a matching call", () => {
    const { run, addMessage, setStreamingStatus } = makeRun();

    createToolHandlers(run).onToolComplete?.("call-orphan", {
      success: false,
      result: "orphaned output",
    });

    expect(getToolStreamingState(SESSION_ID, "call-orphan").status).toBe("completed");
    expect(addMessage).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({
        type: "tool_result",
        toolName: "unknown",
        toolCallId: "call-orphan",
        result: {
          tool_name: "unknown",
          result: "orphaned output",
          display_preference: "Default",
        },
        isError: true,
      }),
    );
    expect(setStreamingStatus).not.toHaveBeenCalled();
  });

  it("marks tool errors terminal and emits a paired error result", () => {
    const {
      run,
      addMessage,
      setStreamingStatus,
      toolNamesByCallIdRef,
      toolCallMessageIdByCallIdRef,
    } = makeRun();
    const handlers = createToolHandlers(run);

    handlers.onToolStart?.("call-error", "Write", { path: "file.txt" });
    handlers.onToolError?.("call-error", "permission denied");

    expect(getToolStreamingState(SESSION_ID, "call-error").status).toBe("error");
    expect(addMessage).toHaveBeenLastCalledWith(
      SESSION_ID,
      expect.objectContaining({
        type: "tool_result",
        toolName: "Write",
        toolCallId: "call-error",
        result: expect.objectContaining({ result: "permission denied" }),
        isError: true,
      }),
    );
    expect(toolNamesByCallIdRef.current.has("call-error")).toBe(false);
    expect(toolCallMessageIdByCallIdRef.current.has("call-error")).toBe(false);
    expect(setStreamingStatus).toHaveBeenLastCalledWith(null);
  });
});
