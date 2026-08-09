import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearAssistantStreamingState,
  flushAssistantStreamingChunks,
  getAssistantStreamingState,
} from "../../../streaming/assistantStreamingAtoms";
import { streamingMessageBus } from "../../../utils/streamingMessageBus";
import type { RunContext, StreamingDraftState } from "../../subscriptionContext";
import { createStreamingHandlers } from "../streamingHandlers";

const SESSION_ID = "session-streaming";
const MESSAGE_ID = "streaming-session-streaming";
const REASONING_MESSAGE_ID = "streaming-reasoning-session-streaming";
const STATUS_MESSAGE_ID = "streaming-status-session-streaming";

function makeRun(streamingState: StreamingDraftState | null = null) {
  const markStreamStartedOnce = vi.fn();
  const setStreamingStatus = vi.fn();
  const streamingStateBySessionRef = {
    current: new Map<string, StreamingDraftState>(
      streamingState ? [[SESSION_ID, streamingState]] : [],
    ),
  };
  const run = {
    ctx: {
      markStreamStartedOnce,
      streamingStateBySessionRef,
    },
    sessionId: SESSION_ID,
    generation: 7,
    controller: new AbortController(),
    messageId: MESSAGE_ID,
    reasoningMessageId: REASONING_MESSAGE_ID,
    statusMessageId: STATUS_MESSAGE_ID,
    setStreamingStatus,
    scheduleParentSettleCheck: vi.fn(),
  } as unknown as RunContext;

  return { run, markStreamStartedOnce, setStreamingStatus };
}

function createDraft(): StreamingDraftState {
  return {
    sessionId: SESSION_ID,
    messageId: MESSAGE_ID,
    content: "",
    reasoningMessageId: REASONING_MESSAGE_ID,
    reasoningContent: "",
    statusMessageId: STATUS_MESSAGE_ID,
    status: "thinking",
  };
}

describe("createStreamingHandlers", () => {
  beforeEach(() => {
    streamingMessageBus.forceFlush();
    clearAssistantStreamingState(SESSION_ID);
    streamingMessageBus.clear(SESSION_ID, MESSAGE_ID);
    streamingMessageBus.clear(SESSION_ID, REASONING_MESSAGE_ID);
  });

  afterEach(() => {
    streamingMessageBus.forceFlush();
    clearAssistantStreamingState(SESSION_ID);
    streamingMessageBus.clear(SESSION_ID, MESSAGE_ID);
    streamingMessageBus.clear(SESSION_ID, REASONING_MESSAGE_ID);
    vi.unstubAllGlobals();
  });

  it("appends text and reasoning tokens while batching transient bus updates into one RAF", () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const draft = createDraft();
    const { run, markStreamStartedOnce, setStreamingStatus } = makeRun(draft);
    const updates: Array<{
      sessionId: string;
      messageId: string;
      content: string | null;
      transient?: boolean;
    }> = [];
    const unsubscribe = streamingMessageBus.subscribe((update) => updates.push(update));
    const handlers = createStreamingHandlers(run);

    handlers.onToken?.("Hel");
    handlers.onToken?.("lo");
    handlers.onReasoningToken?.("think");

    expect(markStreamStartedOnce).toHaveBeenNthCalledWith(1, SESSION_ID, 7);
    expect(markStreamStartedOnce).toHaveBeenCalledTimes(3);
    expect(setStreamingStatus).toHaveBeenCalledTimes(2);
    expect(setStreamingStatus).toHaveBeenLastCalledWith(null);
    expect(draft.content).toBe("Hello");
    expect(draft.reasoningContent).toBe("think");

    flushAssistantStreamingChunks();
    expect(getAssistantStreamingState(SESSION_ID)).toMatchObject({
      content: "Hello",
      reasoningContent: "think",
    });

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([]);
    expect(streamingMessageBus.getLatest(MESSAGE_ID)).toBeNull();

    rafCallbacks[0](16);
    expect(updates).toEqual([
      {
        sessionId: SESSION_ID,
        messageId: MESSAGE_ID,
        content: "lo",
        transient: true,
      },
      {
        sessionId: SESSION_ID,
        messageId: REASONING_MESSAGE_ID,
        content: "think",
        transient: true,
      },
    ]);

    unsubscribe();
  });

  it("marks stream start but ignores tokens after the draft state has been removed", () => {
    const requestAnimationFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);

    const { run, markStreamStartedOnce, setStreamingStatus } = makeRun(null);
    const handlers = createStreamingHandlers(run);

    handlers.onToken?.("late text");
    handlers.onReasoningToken?.("late reasoning");

    expect(markStreamStartedOnce).toHaveBeenCalledTimes(2);
    expect(setStreamingStatus).not.toHaveBeenCalled();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(getAssistantStreamingState(SESSION_ID)).toMatchObject({
      content: "",
      reasoningContent: "",
    });
  });
});
