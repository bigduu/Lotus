import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RunContext } from "../../subscriptionContext";
import { createContextHandlers } from "../contextHandlers";

const { mockStoreState, mockTranslate } = vi.hoisted(() => ({
  mockStoreState: {
    chats: [] as Array<{ id: string; config: Record<string, unknown> }>,
  },
  mockTranslate: vi.fn(
    (key: string, values?: Record<string, unknown>) => `${key}:${JSON.stringify(values ?? {})}`,
  ),
}));

vi.mock("@shared/store/appStore", () => ({
  useAppStore: { getState: () => mockStoreState },
}));

vi.mock("@shared/i18n", () => ({
  default: { t: mockTranslate },
}));

function makeRun() {
  const setStreamingStatus = vi.fn();
  const message = {
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  };
  const ctx = {
    message,
    setTruncationInfo: vi.fn(),
    updateSession: vi.fn(),
    updateTokenUsage: vi.fn(),
  } as unknown as RunContext["ctx"];

  const run = {
    ctx,
    sessionId: "session-1",
    setStreamingStatus,
  } as unknown as RunContext;

  return { run, ctx, message, setStreamingStatus };
}

beforeEach(() => {
  mockStoreState.chats = [];
  mockTranslate.mockClear();
});

describe("createContextHandlers", () => {
  it("maps every compression state to the matching streaming status", () => {
    const { run, setStreamingStatus } = makeRun();
    const handlers = createContextHandlers(run);

    handlers.onContextCompressionStatus?.("pre-turn", "started");
    handlers.onContextCompressionStatus?.("mid-turn", "degraded_sections");
    handlers.onContextCompressionStatus?.("mid-turn", "failed");
    handlers.onContextCompressionStatus?.("mid-turn", "completed");

    expect(setStreamingStatus.mock.calls).toEqual([
      ["context_compacting"],
      ["context_compaction_degraded"],
      ["context_compaction_failed"],
      [null],
    ]);
  });

  it("maps a token budget and persists it without dropping existing chat config", () => {
    mockStoreState.chats = [
      {
        id: "session-1",
        config: { workspacePath: "/workspace", permissionMode: "auto" },
      },
    ];
    const { run, ctx } = makeRun();
    const handlers = createContextHandlers(run);

    handlers.onTokenBudgetUpdated?.({
      system_tokens: 100,
      summary_tokens: 25,
      window_tokens: 300,
      total_tokens: 425,
      max_context_tokens: 1_000,
      budget_limit: 900,
      truncation_occurred: true,
      segments_removed: 2,
      prompt_cached_tool_outputs: 3,
      prompt_cached_tool_tokens_saved: 400,
      thinking_tokens: 50,
      cache_read_input_tokens: 75,
    });

    expect(ctx.updateTokenUsage).toHaveBeenCalledWith("session-1", {
      systemTokens: 100,
      summaryTokens: 25,
      windowTokens: 300,
      totalTokens: 425,
      maxContextTokens: 1_000,
      budgetLimit: 900,
      promptCachedToolOutputs: 3,
      promptCachedToolTokensSaved: 400,
      thinkingTokens: 50,
      cacheReadInputTokens: 75,
    });
    expect(ctx.setTruncationInfo).toHaveBeenCalledWith("session-1", true, 2);
    expect(ctx.updateSession).toHaveBeenCalledWith("session-1", {
      config: expect.objectContaining({
        workspacePath: "/workspace",
        permissionMode: "auto",
        truncationOccurred: true,
        segmentsRemoved: 2,
        tokenUsage: expect.objectContaining({ totalTokens: 425 }),
      }),
    });
  });

  it("does not write a budget when the payload cannot be mapped", () => {
    const { run, ctx } = makeRun();
    const handlers = createContextHandlers(run);

    handlers.onTokenBudgetUpdated?.(undefined as never);

    expect(ctx.updateTokenUsage).not.toHaveBeenCalled();
    expect(ctx.setTruncationInfo).not.toHaveBeenCalled();
    expect(ctx.updateSession).not.toHaveBeenCalled();
  });

  it("clears compaction status and reports a localized summary", () => {
    const { run, message, setStreamingStatus } = makeRun();
    const handlers = createContextHandlers(run);

    handlers.onContextSummarized?.({ messages_summarized: 12, tokens_saved: 3_456 });

    expect(setStreamingStatus).toHaveBeenCalledWith(null);
    expect(mockTranslate).toHaveBeenCalledWith("app.notifications.conversationSummarized", {
      messages: 12,
      tokens: "3,456",
    });
    expect(message.info).toHaveBeenCalledWith(
      expect.stringContaining("app.notifications.conversationSummarized"),
      5,
    );
  });

  it("uses an error toast only for critical context pressure", () => {
    const { run, message } = makeRun();
    const handlers = createContextHandlers(run);

    handlers.onContextPressureNotification?.(95, "critical", "Context almost full");
    handlers.onContextPressureNotification?.(75, "warning", "Context filling up");

    expect(message.error).toHaveBeenCalledWith("Context almost full", 6);
    expect(message.warning).toHaveBeenCalledWith("Context filling up", 5);
  });
});
