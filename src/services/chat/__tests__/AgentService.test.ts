import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { AgentClient, ChatRequest } from "../AgentService";
import { mockFetchError, mockFetchResponse } from "@test/helpers";

describe("AgentClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("deletes a backend session by ID", async () => {
    fetchMock.mockResolvedValue(mockFetchResponse({}));

    const client = AgentClient.getInstance();

    await client.deleteSession("session-1");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/sessions/session-1"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("throws when backend session deletion fails", async () => {
    fetchMock.mockResolvedValue(mockFetchError("Server Error", 500));

    const client = AgentClient.getInstance();

    await expect(client.deleteSession("session-1")).rejects.toThrow();
  });

  it("restores session state for a target message", async () => {
    fetchMock.mockResolvedValue(
      mockFetchResponse({
        success: true,
        session_id: "session-1",
        target_message_id: "msg-1",
        restore_files: true,
        messages_removed: 3,
        message_count: 8,
      }),
    );

    const client = AgentClient.getInstance();

    await client.restoreSessionState("session-1", {
      target_message_id: "msg-1",
      restore_files: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/sessions/session-1/restore"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"target_message_id":"msg-1"'),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"restore_files":true'),
      }),
    );
  });

  it("patches a persisted message by ID", async () => {
    fetchMock.mockResolvedValue(mockFetchResponse({ success: true }));

    const client = AgentClient.getInstance();

    await client.patchSessionMessage("session-1", "msg-1", {
      content: "fixed mermaid content",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/sessions/session-1/messages/msg-1"),
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"content":"fixed mermaid content"'),
      }),
    );
  });

  it("patches a backend session by ID (with URL encoding)", async () => {
    fetchMock.mockResolvedValue(mockFetchResponse({}));

    const client = AgentClient.getInstance();

    await client.patchSession("session/with space", { title: "Updated" });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/sessions/session%2Fwith%20space"),
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"title":"Updated"'),
      }),
    );
  });

  it("patches session-scoped model and reasoning payload", async () => {
    fetchMock.mockResolvedValue(mockFetchResponse({}));

    const client = AgentClient.getInstance();

    await client.patchSession("session-1", {
      model: "gpt-session-specific",
      reasoning_effort: "xhigh",
      clear_reasoning_effort: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/sessions/session-1"),
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"model":"gpt-session-specific"'),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"reasoning_effort":"xhigh"'),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"clear_reasoning_effort":true'),
      }),
    );
  });

  it("deletes a persisted message by ID", async () => {
    fetchMock.mockResolvedValue(mockFetchResponse({}));

    const client = AgentClient.getInstance();

    await client.deleteSessionMessage("session-1", "msg-1");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/sessions/session-1/messages/msg-1"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("truncates session messages with mode payload", async () => {
    fetchMock.mockResolvedValue(
      mockFetchResponse({
        success: true,
        session_id: "session-1",
        messages_removed: 2,
        message_count: 10,
      }),
    );

    const client = AgentClient.getInstance();
    await client.truncateSessionMessages("session-1", {
      mode: "after_last_user",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/sessions/session-1/messages/truncate"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"mode":"after_last_user"'),
      }),
    );
  });

  it("marks session for error retry without truncation", async () => {
    fetchMock.mockResolvedValue(
      mockFetchResponse({
        success: true,
        session_id: "session-1",
        messages_removed: 0,
        message_count: 12,
      }),
    );

    const client = AgentClient.getInstance();
    await client.truncateSessionMessages("session-1", {
      mode: "error_retry",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/sessions/session-1/messages/truncate"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"mode":"error_retry"'),
      }),
    );
  });

  it("cleans up sessions with mode and keep_pinned", async () => {
    fetchMock.mockResolvedValue(mockFetchResponse({ success: true }));
    const client = AgentClient.getInstance();

    await client.cleanupSessions("children", true);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/sessions/cleanup"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"mode":"children"'),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"keep_pinned":true'),
      }),
    );
  });

  it("calls schedule CRUD endpoints", async () => {
    fetchMock
      .mockResolvedValueOnce(mockFetchResponse({ schedules: [] }))
      .mockResolvedValueOnce(mockFetchResponse({ id: "s1" }))
      .mockResolvedValueOnce(mockFetchResponse({ id: "s1", enabled: true }))
      .mockResolvedValueOnce(mockFetchResponse({}))
      .mockResolvedValueOnce(mockFetchResponse({}))
      .mockResolvedValueOnce(
        mockFetchResponse({
          schedule_id: "s1",
          sessions: [],
        }),
      );

    const client = AgentClient.getInstance();
    await client.listSchedules();
    await client.createSchedule({ name: "Daily", interval_seconds: 60 });
    await client.patchSchedule("sched/1", { enabled: true });
    await client.runScheduleNow("sched/1");
    await client.deleteSchedule("sched/1");
    await client.listScheduleSessions("sched/1");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/schedules"),
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/schedules"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"name":"Daily"'),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/schedules/sched%2F1"),
      expect.objectContaining({
        method: "PATCH",
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/schedules/sched%2F1/run"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/schedules/sched%2F1"),
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/schedules/sched%2F1/sessions"),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("calls stop generation and history endpoints", async () => {
    fetchMock
      .mockResolvedValueOnce(mockFetchResponse({}))
      .mockResolvedValueOnce(mockFetchResponse({ session_id: "session-1", messages: [] }));
    const client = AgentClient.getInstance();

    await client.stopGeneration("session-1");
    await client.getHistory("session-1");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/stop/session-1"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/history/session-1"),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("healthCheck returns false on request failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const client = AgentClient.getInstance();
    await expect(client.healthCheck()).resolves.toBe(false);
  });

  describe("Model Requirement", () => {
    it("keeps model-related API types aligned with session-driven execute", () => {
      expectTypeOf<ChatRequest["model"]>().toEqualTypeOf<string>();
      expectTypeOf<Parameters<AgentClient["execute"]>[1]>().toEqualTypeOf<string | undefined>();
      expectTypeOf<Parameters<AgentClient["sendMessage"]>[0]["model"]>().toEqualTypeOf<string>();
    });

    it("execute method allows omitting model for session-driven execution", async () => {
      fetchMock.mockResolvedValue(
        mockFetchResponse({
          session_id: "session-1",
          status: "started",
          events_url: "/events/session-1",
        }),
      );

      const client = AgentClient.getInstance();

      await client.execute("session-1");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/execute/session-1"),
        expect.objectContaining({
          method: "POST",
          body: "{}",
        }),
      );
    });

    it("execute still forwards compatibility model when explicitly provided", async () => {
      fetchMock.mockResolvedValue(
        mockFetchResponse({
          session_id: "session-1",
          status: "started",
          events_url: "/events/session-1",
        }),
      );

      const client = AgentClient.getInstance();

      await client.execute("session-1", "kimi-for-coding");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/execute/session-1"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("kimi-for-coding"),
        }),
      );
    });

    it("sendMessage requires model in request", async () => {
      fetchMock.mockResolvedValue(
        mockFetchResponse({
          session_id: "session-1",
          status: "started",
        }),
      );

      const client = AgentClient.getInstance();

      const request: ChatRequest = {
        message: "Hello",
        model: "kimi-for-coding",
      };

      await client.sendMessage(request);

      // Verify the request was made with model
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/chat"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("kimi-for-coding"),
        }),
      );
    });
  });

  it("dispatches tool_token events to onToolToken handler", () => {
    const client = AgentClient.getInstance();
    const onToolToken = vi.fn();

    // `handleEvent` is intentionally private; we still test the dispatch logic
    // because SSE parsing ultimately routes through this switch.
    (client as any).handleEvent(
      { type: "tool_token", tool_call_id: "call_1", content: "chunk" },
      { onToolToken },
    );

    expect(onToolToken).toHaveBeenCalledWith("call_1", "chunk");
  });

  it("dispatches reasoning_token events", () => {
    const client = AgentClient.getInstance();
    const onReasoningToken = vi.fn();

    (client as any).handleEvent(
      { type: "reasoning_token", content: "thinking..." },
      { onReasoningToken },
    );

    expect(onReasoningToken).toHaveBeenCalledWith("thinking...");
  });

  it("dispatches tool_start events", () => {
    const client = AgentClient.getInstance();
    const onToolStart = vi.fn();

    (client as any).handleEvent(
      {
        type: "tool_start",
        tool_call_id: "call-1",
        tool_name: "test_tool",
        arguments: { arg1: "value1" },
      },
      { onToolStart },
    );

    expect(onToolStart).toHaveBeenCalledWith("call-1", "test_tool", {
      arg1: "value1",
    });
  });

  it("dispatches tool_complete events when result exists", () => {
    const client = AgentClient.getInstance();
    const onToolComplete = vi.fn();

    (client as any).handleEvent(
      {
        type: "tool_complete",
        tool_call_id: "call-1",
        result: { success: true, result: "done" },
      },
      { onToolComplete },
    );

    expect(onToolComplete).toHaveBeenCalledWith("call-1", {
      success: true,
      result: "done",
    });
  });

  it("does not dispatch tool_complete events when result is missing", () => {
    const client = AgentClient.getInstance();
    const onToolComplete = vi.fn();

    (client as any).handleEvent(
      { type: "tool_complete", tool_call_id: "call-1" },
      { onToolComplete },
    );

    expect(onToolComplete).not.toHaveBeenCalled();
  });

  it("dispatches tool_error events", () => {
    const client = AgentClient.getInstance();
    const onToolError = vi.fn();

    (client as any).handleEvent(
      {
        type: "tool_error",
        tool_call_id: "call-1",
        error: "Execution failed",
      },
      { onToolError },
    );

    expect(onToolError).toHaveBeenCalledWith("call-1", "Execution failed");
  });

  it("dispatches task_list_updated events", () => {
    const client = AgentClient.getInstance();
    const onTaskListUpdated = vi.fn();

    const taskList = {
      session_id: "s1",
      title: "Test List",
      items: [],
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };

    (client as any).handleEvent(
      { type: "task_list_updated", task_list: taskList },
      { onTaskListUpdated },
    );

    expect(onTaskListUpdated).toHaveBeenCalledWith(taskList);
  });

  it("does not dispatch task_list_updated when task_list is missing", () => {
    const client = AgentClient.getInstance();
    const onTaskListUpdated = vi.fn();

    (client as any).handleEvent({ type: "task_list_updated" }, { onTaskListUpdated });

    expect(onTaskListUpdated).not.toHaveBeenCalled();
  });

  it("dispatches complete events", () => {
    const client = AgentClient.getInstance();
    const onComplete = vi.fn();

    (client as any).handleEvent(
      {
        type: "complete",
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      },
      { onComplete },
    );

    expect(onComplete).toHaveBeenCalledWith({
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    });
  });

  it("dispatches error events with message field", () => {
    const client = AgentClient.getInstance();
    const onError = vi.fn();

    (client as any).handleEvent({ type: "error", message: "Something went wrong" }, { onError });

    expect(onError).toHaveBeenCalledWith("Something went wrong");
  });

  it("dispatches error events with error field fallback", () => {
    const client = AgentClient.getInstance();
    const onError = vi.fn();

    (client as any).handleEvent({ type: "error", error: "Fallback error" }, { onError });

    expect(onError).toHaveBeenCalledWith("Fallback error");
  });

  it("handles error events with no message or error field", () => {
    const client = AgentClient.getInstance();
    const onError = vi.fn();

    (client as any).handleEvent({ type: "error" }, { onError });

    expect(onError).toHaveBeenCalledWith("Unknown error");
  });

  it("handles unknown event types", () => {
    const client = AgentClient.getInstance();
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    (client as any).handleEvent({ type: "unknown_event" as any }, {});

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "Unknown event type:",
      expect.objectContaining({ type: "unknown_event" }),
    );

    consoleWarnSpy.mockRestore();
  });

  it("dispatches task/sub-session/context events to handlers", () => {
    const client = AgentClient.getInstance();
    const handlers = {
      onTaskListItemProgress: vi.fn(),
      onTaskEvaluationStarted: vi.fn(),
      onTaskEvaluationCompleted: vi.fn(),
      onTokenBudgetUpdated: vi.fn(),
      onContextCompressionStatus: vi.fn(),
      onContextSummarized: vi.fn(),
      onSubSessionStarted: vi.fn(),
      onSubSessionEvent: vi.fn(),
      onSubSessionHeartbeat: vi.fn(),
      onSubSessionCompleted: vi.fn(),
      onError: vi.fn(),
    };

    (client as any).handleEvent(
      {
        type: "task_list_item_progress",
        session_id: "s1",
        item_id: "item1",
        status: "in_progress",
        tool_calls_count: 2,
        version: 1,
      },
      handlers,
    );
    (client as any).handleEvent(
      { type: "task_evaluation_started", session_id: "s1", items_count: 5 },
      handlers,
    );
    (client as any).handleEvent(
      {
        type: "task_evaluation_completed",
        session_id: "s1",
        updates_count: 2,
        reasoning: "done",
      },
      handlers,
    );
    (client as any).handleEvent(
      {
        type: "token_budget_updated",
        usage: {
          system_tokens: 1,
          summary_tokens: 1,
          window_tokens: 1,
          total_tokens: 3,
          budget_limit: 10,
          truncation_occurred: false,
          segments_removed: 0,
        },
      },
      handlers,
    );
    (client as any).handleEvent(
      {
        type: "context_compression_status",
        phase: "mid-turn",
        status: "started",
      },
      handlers,
    );
    (client as any).handleEvent(
      {
        type: "context_summarized",
        summary_info: {
          summary: "sum",
          messages_summarized: 3,
          tokens_saved: 20,
        },
      },
      handlers,
    );
    (client as any).handleEvent(
      {
        type: "sub_session_started",
        parent_session_id: "p",
        child_session_id: "c",
        title: "child",
      },
      handlers,
    );
    (client as any).handleEvent(
      {
        type: "sub_session_event",
        parent_session_id: "p",
        child_session_id: "c",
        event: { type: "token", content: "x" },
      },
      handlers,
    );
    (client as any).handleEvent(
      {
        type: "sub_session_heartbeat",
        parent_session_id: "p",
        child_session_id: "c",
        timestamp: "2026-01-01T00:00:00Z",
      },
      handlers,
    );
    (client as any).handleEvent(
      {
        type: "sub_session_completed",
        parent_session_id: "p",
        child_session_id: "c",
        status: "completed",
      },
      handlers,
    );
    (client as any).handleEvent({ type: "error", message: "boom" }, handlers);

    expect(handlers.onTaskListItemProgress).toHaveBeenCalledTimes(1);
    expect(handlers.onTaskEvaluationStarted).toHaveBeenCalledWith("s1", 5);
    expect(handlers.onTaskEvaluationCompleted).toHaveBeenCalledWith("s1", 2, "done");
    expect(handlers.onTokenBudgetUpdated).toHaveBeenCalledTimes(1);
    expect(handlers.onContextCompressionStatus).toHaveBeenCalledWith("mid-turn", "started");
    expect(handlers.onContextSummarized).toHaveBeenCalledWith({
      summary: "sum",
      messages_summarized: 3,
      tokens_saved: 20,
    });
    expect(handlers.onSubSessionStarted).toHaveBeenCalledWith("p", "c", "child");
    expect(handlers.onSubSessionEvent).toHaveBeenCalledTimes(1);
    expect(handlers.onSubSessionHeartbeat).toHaveBeenCalledTimes(1);
    expect(handlers.onSubSessionCompleted).toHaveBeenCalledWith("p", "c", "completed", undefined);
    expect(handlers.onError).toHaveBeenCalledWith("boom");
  });

  it("ignores invalid task progress status values", () => {
    const client = AgentClient.getInstance();
    const onTaskListItemProgress = vi.fn();

    (client as any).handleEvent(
      {
        type: "task_list_item_progress",
        session_id: "s1",
        item_id: "item1",
        status: "not-a-valid-status",
        tool_calls_count: 2,
        version: 1,
      },
      { onTaskListItemProgress },
    );

    expect(onTaskListItemProgress).not.toHaveBeenCalled();
  });

  it("subscribeToEvents parses SSE token and DONE marker", async () => {
    const client = AgentClient.getInstance();
    const onToken = vi.fn();

    const chunks = [
      new TextEncoder().encode('data: {"type":"token","content":"hello"}\n'),
      new TextEncoder().encode("\n"),
      new TextEncoder().encode("data: [DONE]\n\n"),
    ];
    let index = 0;

    const reader = {
      read: vi.fn(async () => {
        if (index < chunks.length) {
          return { done: false, value: chunks[index++] };
        }
        return { done: true, value: undefined };
      }),
      releaseLock: vi.fn(),
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "text/event-stream" }),
      body: {
        getReader: () => reader,
      },
    } as unknown as Response);

    await client.subscribeToEvents("session-1", { onToken });

    expect(onToken).toHaveBeenCalledWith("hello");
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  });
});
