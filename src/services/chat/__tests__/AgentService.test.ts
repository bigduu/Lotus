import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { AgentClient, ChatRequest } from "../AgentService";
import { __resetV2StreamForTests } from "../v2Stream";
import { mockFetchError, mockFetchResponse } from "@test/helpers";

describe("AgentClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let eventSourceInstances: Array<{
    url: string;
    withCredentials: boolean;
    onopen: (() => void) | null;
    onmessage: ((event: MessageEvent<string>) => void) | null;
    onerror: ((event?: Event) => void) | null;
    close: ReturnType<typeof vi.fn>;
  }>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    eventSourceInstances = [];

    class MockEventSource {
      url: string;
      withCredentials: boolean;
      onopen: (() => void) | null = null;
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onerror: ((event?: Event) => void) | null = null;
      close = vi.fn();

      constructor(url: string | URL, init?: EventSourceInit) {
        this.url = String(url);
        this.withCredentials = init?.withCredentials ?? false;
        eventSourceInstances.push(this);
      }
    }

    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("gets a task list snapshot for a session", async () => {
    fetchMock.mockResolvedValue(
      mockFetchResponse({
        session_id: "session-1",
        title: "Task List",
        items: [
          {
            id: "task-1",
            description: "Do the thing",
            status: "in_progress",
            depends_on: [],
            notes: "",
          },
        ],
        progress: {
          completed: 0,
          total: 1,
          percentage: 0,
        },
      }),
    );

    const client = AgentClient.getInstance();
    const result = await client.getTaskList("session-1");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/task/session-1"),
      expect.objectContaining({ method: "GET" }),
    );
    expect(result).toMatchObject({
      session_id: "session-1",
      title: "Task List",
      items: [expect.objectContaining({ id: "task-1", status: "in_progress" })],
    });
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

  it("posts a child-approval decision to the right path and body", async () => {
    fetchMock.mockResolvedValue(mockFetchResponse({ delivered: true }));

    const client = AgentClient.getInstance();
    const result = await client.respondToChildApproval("child/with space", "req-1", true);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/child-approval/child%2Fwith%20space"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"request_id":"req-1"'),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"approved":true'),
      }),
    );
    expect(result.delivered).toBe(true);
  });

  it("surfaces a not-delivered child-approval response when the child is gone", async () => {
    fetchMock.mockResolvedValue(mockFetchResponse({ delivered: false }));

    const client = AgentClient.getInstance();
    const result = await client.respondToChildApproval("child-1", "req-1", false);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"approved":false'),
      }),
    );
    expect(result.delivered).toBe(false);
  });

  it("gets a session system prompt snapshot with aligned fields", async () => {
    fetchMock.mockResolvedValue(
      mockFetchResponse({
        session_id: "session-1",
        base_system_prompt: "Base prompt",
        instruction_context: "Instruction context",
        dream_notebook: "Dream note",
        session_memory_note: "Session note",
        effective_system_prompt: "Effective prompt",
      }),
    );

    const client = AgentClient.getInstance();
    const result = await client.getSessionSystemPrompt("session/with space");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/sessions/session%2Fwith%20space/system-prompt"),
      expect.objectContaining({ method: "GET" }),
    );
    expect(result.instruction_context).toBe("Instruction context");
    expect(result.dream_notebook).toBe("Dream note");
    expect(result.session_memory_note).toBe("Session note");

    expectTypeOf(result.instruction_context).toEqualTypeOf<string | undefined>();
    expectTypeOf(result.dream_notebook).toEqualTypeOf<string | undefined>();
    expectTypeOf(result.session_memory_note).toEqualTypeOf<string | undefined>();
  });

  it("runs project dream for a backend session", async () => {
    fetchMock.mockResolvedValue(
      mockFetchResponse({
        success: true,
        session_id: "session-1",
        project_key: "project-1",
        dream_generated: true,
        used_model: "fast-model",
      }),
    );

    const client = AgentClient.getInstance();
    const result = await client.runProjectDream("session/with space");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/sessions/session%2Fwith%20space/project-dream/run"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.dream_generated).toBe(true);
    expectTypeOf(result.project_key).toEqualTypeOf<string>();
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

  it("calls schedule CRUD and run history endpoints", async () => {
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
      )
      .mockResolvedValueOnce(
        mockFetchResponse({
          schedule_id: "s1",
          runs: [],
        }),
      );

    const client = AgentClient.getInstance();
    await client.listSchedules();
    await client.createSchedule({
      name: "Daily",
      trigger: { type: "interval", every_seconds: 60 },
    });
    await client.patchSchedule("sched/1", { enabled: true });
    await client.runScheduleNow("sched/1");
    await client.deleteSchedule("sched/1");
    await client.listScheduleSessions("sched/1");
    await client.listScheduleRuns("sched/1");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/schedules"),
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/schedules"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"trigger":{"type":"interval","every_seconds":60}'),
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
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/schedules/sched%2F1/runs"),
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

  it("subscribes to events with native EventSource", async () => {
    const client = AgentClient.getInstance();
    const onToken = vi.fn();
    const controller = new AbortController();

    const pending = client.subscribeToEvents("session-1", { onToken }, controller);

    expect(eventSourceInstances).toHaveLength(1);
    expect(eventSourceInstances[0]?.url).toContain("/api/v1/events/session-1");
    expect(eventSourceInstances[0]?.withCredentials).toBe(true);

    eventSourceInstances[0]?.onmessage?.({ data: "[KEEPALIVE]" } as MessageEvent<string>);
    expect(onToken).not.toHaveBeenCalled();

    eventSourceInstances[0]?.onmessage?.({
      data: JSON.stringify({ type: "token", content: "hello" }),
    } as MessageEvent<string>);
    expect(onToken).toHaveBeenCalledWith("hello");

    eventSourceInstances[0]?.onmessage?.({ data: "[DONE]" } as MessageEvent<string>);
    await expect(pending).resolves.toBeUndefined();
    expect(eventSourceInstances[0]?.close).toHaveBeenCalled();
  });

  it("rejects subscribeToEvents on EventSource error before terminal event", async () => {
    const client = AgentClient.getInstance();

    const pending = client.subscribeToEvents("session-1", {});

    expect(eventSourceInstances).toHaveLength(1);
    eventSourceInstances[0]?.onerror?.();

    await expect(pending).rejects.toThrow("EventSource connection failed for session session-1");
    expect(eventSourceInstances[0]?.close).toHaveBeenCalled();
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

  it("dispatches cancelled events", () => {
    const client = AgentClient.getInstance();
    const onCancelled = vi.fn();

    (client as any).handleEvent(
      { type: "cancelled", message: "Agent execution cancelled by user" },
      { onCancelled },
    );

    expect(onCancelled).toHaveBeenCalledWith("Agent execution cancelled by user");
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

  it("dispatches context_pressure_notification events", () => {
    const client = AgentClient.getInstance();
    const onContextPressureNotification = vi.fn();

    (client as any).handleEvent(
      {
        type: "context_pressure_notification",
        percent: 75.5,
        level: "warning",
        message: "Context window filling up (~75%). Consider using compact_context.",
      },
      { onContextPressureNotification },
    );

    expect(onContextPressureNotification).toHaveBeenCalledWith(
      75.5,
      "warning",
      "Context window filling up (~75%). Consider using compact_context.",
    );
  });

  it("ignores context_pressure_notification without percent or level", () => {
    const client = AgentClient.getInstance();
    const onContextPressureNotification = vi.fn();

    (client as any).handleEvent(
      { type: "context_pressure_notification", message: "missing fields" },
      { onContextPressureNotification },
    );

    expect(onContextPressureNotification).not.toHaveBeenCalled();
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

  it("dispatches runner_progress events to onRunnerProgress handler", () => {
    const client = AgentClient.getInstance();
    const onRunnerProgress = vi.fn();

    (client as any).handleEvent(
      { type: "runner_progress", session_id: "sess-1", round_count: 0 },
      { onRunnerProgress },
    );

    expect(onRunnerProgress).toHaveBeenCalledWith("sess-1", 0);
  });

  it("does not warn for known runner_progress event", () => {
    const client = AgentClient.getInstance();
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    (client as any).handleEvent(
      { type: "runner_progress", session_id: "sess-1", round_count: 2 },
      { onRunnerProgress: () => {} },
    );

    expect(consoleWarnSpy).not.toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
  });

  it("ignores malformed runner_progress (missing session_id or non-numeric round_count)", () => {
    const client = AgentClient.getInstance();
    const onRunnerProgress = vi.fn();

    (client as any).handleEvent({ type: "runner_progress", round_count: 0 }, { onRunnerProgress });
    (client as any).handleEvent(
      { type: "runner_progress", session_id: "sess-1" },
      { onRunnerProgress },
    );
    (client as any).handleEvent(
      { type: "runner_progress", session_id: "sess-1", round_count: "0" as any },
      { onRunnerProgress },
    );

    expect(onRunnerProgress).not.toHaveBeenCalled();
  });

  it("dispatches task/sub-agent/context events to handlers", () => {
    const client = AgentClient.getInstance();
    const handlers = {
      onTaskListItemProgress: vi.fn(),
      onTaskEvaluationStarted: vi.fn(),
      onTaskEvaluationCompleted: vi.fn(),
      onTokenBudgetUpdated: vi.fn(),
      onContextCompressionStatus: vi.fn(),
      onContextSummarized: vi.fn(),
      onSubAgentStarted: vi.fn(),
      onSubAgentEvent: vi.fn(),
      onSubAgentHeartbeat: vi.fn(),
      onSubAgentCompleted: vi.fn(),
      onChildApprovalRequested: vi.fn(),
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
        type: "sub_agent_started",
        parent_session_id: "p",
        child_session_id: "c",
        title: "child",
      },
      handlers,
    );
    (client as any).handleEvent(
      {
        type: "sub_agent_event",
        parent_session_id: "p",
        child_session_id: "c",
        event: { type: "token", content: "x" },
      },
      handlers,
    );
    (client as any).handleEvent(
      {
        type: "sub_agent_heartbeat",
        parent_session_id: "p",
        child_session_id: "c",
        timestamp: "2026-01-01T00:00:00Z",
      },
      handlers,
    );
    (client as any).handleEvent(
      {
        type: "sub_agent_completed",
        parent_session_id: "p",
        child_session_id: "c",
        status: "completed",
      },
      handlers,
    );
    (client as any).handleEvent(
      {
        type: "child_approval_requested",
        child_session_id: "c",
        request_id: "req-1",
        tool_name: "Bash",
        permission: "execute",
        resource: "rm -rf /tmp/x",
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
    expect(handlers.onSubAgentStarted).toHaveBeenCalledWith("p", "c", "child");
    expect(handlers.onSubAgentEvent).toHaveBeenCalledTimes(1);
    expect(handlers.onSubAgentHeartbeat).toHaveBeenCalledTimes(1);
    expect(handlers.onSubAgentCompleted).toHaveBeenCalledWith("p", "c", "completed", undefined);
    expect(handlers.onChildApprovalRequested).toHaveBeenCalledWith("c", "req-1", {
      toolName: "Bash",
      permission: "execute",
      resource: "rm -rf /tmp/x",
    });
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

  it("subscribeToEvents resolves on EventSource DONE marker", async () => {
    const client = AgentClient.getInstance();
    const onToken = vi.fn();

    const pending = client.subscribeToEvents("session-1", { onToken });

    expect(eventSourceInstances).toHaveLength(1);
    eventSourceInstances[0]?.onmessage?.({
      data: JSON.stringify({ type: "token", content: "hello" }),
    } as MessageEvent<string>);
    eventSourceInstances[0]?.onmessage?.({ data: "[DONE]" } as MessageEvent<string>);

    await expect(pending).resolves.toBeUndefined();
    expect(onToken).toHaveBeenCalledWith("hello");
    expect(eventSourceInstances[0]?.close).toHaveBeenCalled();
  });

  // --- Opt-in v2 WebSocket transport (apiV2Ws flag) ------------------------

  describe("apiV2Ws feature flag (default OFF)", () => {
    // A minimal global WebSocket so the v2 path can construct a socket.
    let wsInstances: MockWS[];

    class MockWS {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 3;
      readyState = 0; // CONNECTING; call open() to flush subscribes
      sent: string[] = [];
      onopen: (() => void) | null = null;
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      constructor(public url: string) {
        wsInstances.push(this);
      }
      send(d: string): void {
        this.sent.push(d);
      }
      close(): void {
        this.readyState = 3;
      }
      open(): void {
        this.readyState = 1;
        this.onopen?.();
      }
      emit(frame: unknown): void {
        this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent);
      }
      parsed(): Array<Record<string, unknown>> {
        return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
      }
    }

    beforeEach(() => {
      wsInstances = [];
      vi.stubGlobal("WebSocket", MockWS as unknown as typeof WebSocket);
    });

    afterEach(() => {
      __resetV2StreamForTests();
      localStorage.removeItem("bodhi_api_v2_ws");
    });

    it("stays on EventSource when the flag is OFF (default)", () => {
      const client = AgentClient.getInstance();
      client.subscribeToAccountStream({ onChange: vi.fn() }, { since: 0 });
      expect(eventSourceInstances).toHaveLength(1);
      expect(wsInstances).toHaveLength(0);
    });

    it("routes the account feed over the WS when the flag is ON", () => {
      localStorage.setItem("bodhi_api_v2_ws", "1");
      const client = AgentClient.getInstance();
      const onChange = vi.fn();

      const handle = client.subscribeToAccountStream({ onChange }, { since: 3 });
      expect(eventSourceInstances).toHaveLength(0);
      expect(wsInstances).toHaveLength(1);
      wsInstances[0]?.open();
      expect(wsInstances[0]?.parsed()).toContainEqual({ type: "subscribe", ch: "feed", since: 3 });

      const ev = { seq: 4, ts: "t", session_id: "s1", event: { type: "message_appended" } };
      wsInstances[0]?.emit({ ch: "feed", seq: 4, event: ev });
      expect(onChange).toHaveBeenCalledWith(ev);

      expect(typeof handle.close).toBe("function");
      handle.close();
    });

    it("routes agent events over the WS and resolves on terminal when the flag is ON", async () => {
      localStorage.setItem("bodhi_api_v2_ws", "1");
      const client = AgentClient.getInstance();
      const onToken = vi.fn();

      const pending = client.subscribeToEvents("session-1", { onToken });
      expect(eventSourceInstances).toHaveLength(0);
      expect(wsInstances).toHaveLength(1);
      wsInstances[0]?.open();
      expect(wsInstances[0]?.parsed()).toContainEqual({
        type: "subscribe",
        ch: "agent.session-1",
      });

      wsInstances[0]?.emit({
        ch: "agent.session-1",
        seq: 1,
        event: { type: "token", content: "hi" },
      });
      expect(onToken).toHaveBeenCalledWith("hi");

      wsInstances[0]?.emit({ ch: "agent.session-1", seq: 2, control: { type: "terminal" } });
      await expect(pending).resolves.toBeUndefined();
    });

    it("closes the WS agent subscription when the abort signal fires", async () => {
      localStorage.setItem("bodhi_api_v2_ws", "1");
      const client = AgentClient.getInstance();
      const controller = new AbortController();

      const pending = client.subscribeToEvents("session-1", {}, controller);
      expect(wsInstances).toHaveLength(1);
      wsInstances[0]?.open();

      controller.abort();
      await expect(pending).resolves.toBeUndefined();
      expect(wsInstances[0]?.parsed()).toContainEqual({
        type: "unsubscribe",
        ch: "agent.session-1",
      });
    });
  });
});
