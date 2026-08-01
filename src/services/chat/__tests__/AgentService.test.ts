import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { AgentClient, ChatRequest } from "../AgentService";
import { __resetV2StreamForTests, subscribeFeed } from "../v2Stream";
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
    // The v2 WS transport now defaults ON. These suite-level tests exercise the
    // legacy SSE path, so force the flag OFF ("0") here; the dedicated flag
    // describe block below opts back IN per-test.
    localStorage.setItem("bodhi_api_v2_ws", "0");

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
    localStorage.removeItem("bodhi_api_v2_ws");
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
    // No `version` in the raw response → must stay undefined (NOT default to
    // 0), so the store's monotonic guard treats it as unknown rather than as
    // a version-0 snapshot that can regress a tracked list (#39).
    expect(result?.version).toBeUndefined();
  });

  it("carries a real version through a task list snapshot when the backend provides one (#39)", async () => {
    fetchMock.mockResolvedValue(
      mockFetchResponse({
        session_id: "session-1",
        title: "Task List",
        items: [],
        progress: { completed: 0, total: 0, percentage: 0 },
        version: 12,
      }),
    );

    const client = AgentClient.getInstance();
    const result = await client.getTaskList("session-1");

    expect(result?.version).toBe(12);
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

  describe("getPendingQuestion (#37)", () => {
    it("returns the authoritative response when the backend answers", async () => {
      fetchMock.mockResolvedValue(mockFetchResponse({ has_pending_question: false }));

      const client = AgentClient.getInstance();
      await expect(client.getPendingQuestion("session-1")).resolves.toEqual({
        has_pending_question: false,
      });
    });

    it("returns a pending question payload verbatim", async () => {
      fetchMock.mockResolvedValue(
        mockFetchResponse({
          has_pending_question: true,
          question: "Which file?",
          options: ["a", "b"],
          allow_custom: true,
          tool_call_id: "tc-1",
        }),
      );

      const client = AgentClient.getInstance();
      await expect(client.getPendingQuestion("session-1")).resolves.toEqual({
        has_pending_question: true,
        question: "Which file?",
        options: ["a", "b"],
        allow_custom: true,
        tool_call_id: "tc-1",
      });
    });

    it("returns null — NOT {has_pending_question:false} — when every transport attempt fails", async () => {
      // A network error is retried internally (1s/2s backoff) before the
      // caller ever sees it. All 3 attempts fail here.
      vi.useFakeTimers();
      try {
        fetchMock
          .mockRejectedValueOnce(new TypeError("Failed to fetch"))
          .mockRejectedValueOnce(new TypeError("Failed to fetch"))
          .mockRejectedValueOnce(new TypeError("Failed to fetch"));

        const client = AgentClient.getInstance();
        const promise = client.getPendingQuestion("session-1");
        const assertion = expect(promise).resolves.toBeNull();

        await vi.advanceTimersByTimeAsync(1000);
        await vi.advanceTimersByTimeAsync(2000);

        await assertion;
        expect(fetchMock).toHaveBeenCalledTimes(3);
      } finally {
        vi.useRealTimers();
      }
    });
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

  it("switches workspace with workspace-only payload and quoted If-Match (#155)", async () => {
    fetchMock.mockResolvedValue(
      mockFetchResponse({
        session: {
          id: "session/with space",
          project_id: "proj-zenith",
          workspace_path: "/repo/zenith-worktree",
        },
      }),
    );

    const client = AgentClient.getInstance();
    const confirmed = await client.switchSessionWorkspace(
      "session/with space",
      "/repo/zenith-worktree",
      7,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/sessions/session%2Fwith%20space");
    expect(init).toEqual(
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ "If-Match": '"7"' }),
      }),
    );
    expect(JSON.parse(String(init.body))).toEqual({
      workspace_path: "/repo/zenith-worktree",
    });
    expect(JSON.parse(String(init.body))).not.toHaveProperty("project_id");
    expect(confirmed).toMatchObject({
      project_id: "proj-zenith",
      workspace_path: "/repo/zenith-worktree",
    });
  });

  it("assigns a session Project and its primary path in one CAS patch (#208)", async () => {
    fetchMock.mockResolvedValue(
      mockFetchResponse({
        session: {
          id: "session/with space",
          project_id: "proj-zenith",
          workspace_path: "/repo/zenith",
        },
      }),
    );

    const client = AgentClient.getInstance();
    const confirmed = await client.reassignSessionProject(
      "session/with space",
      "proj-zenith",
      9,
      "/repo/zenith",
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/sessions/session%2Fwith%20space");
    expect(init).toEqual(
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ "If-Match": '"9"' }),
      }),
    );
    expect(JSON.parse(String(init.body))).toEqual({
      project_id: "proj-zenith",
      workspace_path: "/repo/zenith",
    });
    expect(confirmed).toMatchObject({
      project_id: "proj-zenith",
      workspace_path: "/repo/zenith",
    });
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

  it("fetches the authoritative sub-agent snapshot", async () => {
    fetchMock.mockResolvedValue(
      mockFetchResponse({
        schema_version: 1,
        snapshot_seq: 41,
        approvals_revision: 7,
        generated_at: "2026-07-22T00:00:00Z",
        approvals: [],
        children: [],
      }),
    );

    const client = AgentClient.getInstance();
    const result = await client.getSubagentSnapshot();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/subagents/snapshot"),
      expect.objectContaining({ method: "GET" }),
    );
    expect(result.snapshot_seq).toBe(41);
    expect(result.approvals_revision).toBe(7);
  });

  it("gets a session system prompt snapshot with aligned fields", async () => {
    fetchMock.mockResolvedValue(
      mockFetchResponse({
        session_id: "session-1",
        base_system_prompt: "Base prompt",
        project_context: "Project context",
        workspace_context: "Workspace context",
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
    expect(result.project_context).toBe("Project context");
    expect(result.workspace_context).toBe("Workspace context");
    expect(result.instruction_context).toBe("Instruction context");
    expect(result.dream_notebook).toBe("Dream note");
    expect(result.session_memory_note).toBe("Session note");

    expectTypeOf(result.project_context).toEqualTypeOf<string | undefined>();
    expectTypeOf(result.workspace_context).toEqualTypeOf<string | undefined>();
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

  it("does not reject on transient EventSource errors before a terminal event (lets the browser reconnect)", async () => {
    const client = AgentClient.getInstance();

    const pending = client.subscribeToEvents("session-1", {});

    expect(eventSourceInstances).toHaveLength(1);
    // Simulate a transient disconnect (wifi flicker, tab throttle). The
    // browser auto-reconnects, so the subscription promise should stay
    // pending and EventSource should not be closed.
    eventSourceInstances[0]?.onerror?.();

    // Still pending; resolve it via the terminal [DONE] marker.
    eventSourceInstances[0]?.onmessage?.({ data: "[DONE]" } as MessageEvent<string>);
    await expect(pending).resolves.toBeUndefined();
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
      onTaskEvaluationCancelled: vi.fn(),
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
    (client as any).handleEvent({ type: "task_evaluation_cancelled", session_id: "s1" }, handlers);
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
    expect(handlers.onTaskEvaluationStarted).toHaveBeenCalledWith("s1", 5, undefined);
    expect(handlers.onTaskEvaluationCompleted).toHaveBeenCalledWith("s1", 2, "done", undefined);
    expect(handlers.onTaskEvaluationCancelled).toHaveBeenCalledWith("s1", undefined);
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

  // --- v2 WebSocket transport (apiV2Ws flag, default ON + SSE fallback) -----

  describe("apiV2Ws feature flag (default ON, falls back to SSE)", () => {
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
      // Simulate the socket closing BEFORE it ever opened (old/unreachable backend).
      drop(): void {
        this.readyState = 3;
        this.onclose?.();
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
      // Re-arm: the suite-level beforeEach forced the flag OFF ("0"); this block
      // tests the default-ON behavior, so clear it back to unset.
      localStorage.removeItem("bodhi_api_v2_ws");
      vi.stubGlobal("WebSocket", MockWS as unknown as typeof WebSocket);
    });

    afterEach(() => {
      __resetV2StreamForTests();
      localStorage.removeItem("bodhi_api_v2_ws");
    });

    it("attempts the WS account feed when the flag is unset (default ON)", () => {
      const client = AgentClient.getInstance();
      client.subscribeToAccountStream({ onChange: vi.fn() }, { since: 0 });
      // Default ON: a WebSocket is constructed, no EventSource yet.
      expect(wsInstances).toHaveLength(1);
      expect(eventSourceInstances).toHaveLength(0);
    });

    it("forces SSE (never a WebSocket) when the flag is set to '0'", () => {
      localStorage.setItem("bodhi_api_v2_ws", "0");
      const client = AgentClient.getInstance();
      client.subscribeToAccountStream({ onChange: vi.fn() }, { since: 0 });
      expect(eventSourceInstances).toHaveLength(1);
      expect(wsInstances).toHaveLength(0);
    });

    it("forces SSE (never a WebSocket) when the flag is set to 'false'", () => {
      localStorage.setItem("bodhi_api_v2_ws", "false");
      const client = AgentClient.getInstance();
      client.subscribeToEvents("session-1", { onToken: vi.fn() });
      expect(eventSourceInstances).toHaveLength(1);
      expect(wsInstances).toHaveLength(0);
    });

    it("falls back to SSE (no throw, no stuck feed) when the WebSocket constructor throws synchronously", async () => {
      // A malformed URL / CSP / mixed-content block makes `new WebSocket()` throw
      // SYNCHRONOUSLY inside subscribeFeed. The connect-failed fire used to re-enter
      // the caller's closure before its `wsHandle` binding existed (swallowed
      // temporal-dead-zone ReferenceError → no fallback → a stuck no-events account
      // feed). The feed MUST degrade to the legacy SSE instead.
      vi.stubGlobal(
        "WebSocket",
        class {
          constructor() {
            throw new SyntaxError("malformed ws url");
          }
        } as unknown as typeof WebSocket,
      );
      const client = AgentClient.getInstance();
      const onChange = vi.fn();
      expect(() => client.subscribeToAccountStream({ onChange }, { since: 0 })).not.toThrow();
      // The connect-failed signal is deferred to a microtask; let it run.
      await Promise.resolve();
      await Promise.resolve();
      // Degraded to SSE rather than stranding the feed.
      expect(eventSourceInstances.length).toBeGreaterThanOrEqual(1);
    });

    it("routes the account feed over the WS when ON, and SSE is NOT used", () => {
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
      // WS won: no SSE was ever created.
      expect(eventSourceInstances).toHaveLength(0);

      expect(typeof handle.close).toBe("function");
      handle.close();
    });

    it("routes agent events over the WS and resolves on terminal when ON", async () => {
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

    // --- Initial-connect-failure fallback to SSE ---------------------------

    it("falls back to the SSE feed when the initial WS connect drops before open", () => {
      const client = AgentClient.getInstance();
      const onChange = vi.fn();

      const handle = client.subscribeToAccountStream({ onChange }, { since: 7 });
      expect(wsInstances).toHaveLength(1);
      expect(eventSourceInstances).toHaveLength(0);

      // Initial connect fails: socket closes before ever opening.
      wsInstances[0]?.drop();

      // The feed transparently degrades to SSE with the same handlers + since.
      expect(eventSourceInstances).toHaveLength(1);
      expect(eventSourceInstances[0]?.url).toContain("/api/v1/stream?since=7");

      // Handlers still fire over the SSE transport.
      eventSourceInstances[0]?.onmessage?.({
        data: JSON.stringify({ seq: 8, ts: "t", session_id: "s1", event: { type: "complete" } }),
      } as MessageEvent<string>);
      expect(onChange).toHaveBeenCalled();

      // The handle now closes the active (SSE) transport.
      handle.close();
      expect(eventSourceInstances[0]?.close).toHaveBeenCalled();
    });

    it("falls back to SSE when the initial WS connect times out (open-timeout)", () => {
      vi.useFakeTimers();
      try {
        const client = AgentClient.getInstance();
        const handle = client.subscribeToAccountStream({ onChange: vi.fn() }, { since: 0 });
        expect(wsInstances).toHaveLength(1);
        expect(eventSourceInstances).toHaveLength(0);

        // Never call open(); let the open-timeout fire.
        vi.advanceTimersByTime(4000);

        expect(eventSourceInstances).toHaveLength(1);
        handle.close();
      } finally {
        vi.useRealTimers();
      }
    });

    it("does NOT fall back on a post-open drop (uses WS reconnect instead)", () => {
      vi.useFakeTimers();
      try {
        const client = AgentClient.getInstance();
        client.subscribeToAccountStream({ onChange: vi.fn() }, { since: 0 });
        expect(wsInstances).toHaveLength(1);

        // Open succeeds first...
        wsInstances[0]?.open();
        // ...then the socket drops. This must NOT create an EventSource; the WS
        // client's own bounded-backoff reconnect handles it.
        wsInstances[0]?.drop();
        vi.advanceTimersByTime(10000);

        expect(eventSourceInstances).toHaveLength(0);
        // A fresh WS reconnect was attempted instead.
        expect(wsInstances.length).toBeGreaterThanOrEqual(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("falls back to the SSE agent path when the initial WS connect drops, preserving abort", async () => {
      const client = AgentClient.getInstance();
      const controller = new AbortController();
      const onToken = vi.fn();

      const pending = client.subscribeToEvents("session-1", { onToken }, controller);
      expect(wsInstances).toHaveLength(1);
      expect(eventSourceInstances).toHaveLength(0);

      // Initial connect fails.
      wsInstances[0]?.drop();

      // Degraded to the SSE agent path.
      expect(eventSourceInstances).toHaveLength(1);
      expect(eventSourceInstances[0]?.url).toContain("/api/v1/events/session-1");

      eventSourceInstances[0]?.onmessage?.({
        data: JSON.stringify({ type: "token", content: "via-sse" }),
      } as MessageEvent<string>);
      expect(onToken).toHaveBeenCalledWith("via-sse");

      // Abort closes the active (fallback SSE) transport and resolves the Promise.
      controller.abort();
      await expect(pending).resolves.toBeUndefined();
      expect(eventSourceInstances[0]?.close).toHaveBeenCalled();
    });

    it("does not open a leaked SSE when the handle is closed before fallback fires", () => {
      const client = AgentClient.getInstance();
      const handle = client.subscribeToAccountStream({ onChange: vi.fn() }, { since: 0 });
      expect(wsInstances).toHaveLength(1);

      // Caller tears down BEFORE the connect-failure signal.
      handle.close();
      // Now the (late) initial-connect failure fires — it must NOT open an SSE.
      wsInstances[0]?.drop();

      expect(eventSourceInstances).toHaveLength(0);
    });

    // --- C1: synchronous already-failed fire must not TDZ-crash -------------

    /**
     * Latch the shared v2Stream into a known connect-FAILED state with a live
     * subscription still present, so a SUBSEQUENT subscribe hits the synchronous
     * already-failed branch of `registerConnectFailed` (the C1 path).
     *
     * We use a low-level `subscribeFeed` whose `onConnectFailed` deliberately
     * does NOT close — keeping `feedChannel` alive (so `closeIfIdle` cannot reset
     * connectivity) and `connectFailed` latched true. Returns the latch handle so
     * the test can release it afterwards.
     */
    const latchConnectFailed = (): { close: () => void } => {
      const latch = subscribeFeed({ onChange: vi.fn() }, 0, () => {
        /* intentionally do NOT close: keep the subscription + connectFailed alive */
      });
      // Drop the (only) socket before it opens → declares connect failure.
      expect(wsInstances).toHaveLength(1);
      wsInstances[0]?.drop();
      return latch;
    };

    it("(C1 feed) a feed subscribe while already connect-failed does not throw (sync fire) and uses SSE", async () => {
      const client = AgentClient.getInstance();
      const latch = latchConnectFailed();

      // connectFailed is now latched true with a live subscription. A fresh
      // service-level feed subscribe registers its callback against the
      // already-failed verdict → synchronous fire (deferred to a microtask).
      // This must NOT throw a TDZ ReferenceError on the hoisted `wsHandle`/
      // `closed`/`active` closure state.
      const onChange = vi.fn();
      let handle: ReturnType<AgentClient["subscribeToAccountStream"]>;
      expect(() => {
        handle = client.subscribeToAccountStream({ onChange }, { since: 5 });
      }).not.toThrow();

      // Let the deferred fire run.
      await Promise.resolve();
      await Promise.resolve();

      // The new feed transparently degraded to SSE.
      expect(eventSourceInstances.some((es) => es.url.includes("/api/v1/stream?since=5"))).toBe(
        true,
      );

      handle!.close();
      latch.close();
    });

    it("(C1 agent) an agent subscribe while already connect-failed does not throw (sync fire) and uses SSE", async () => {
      const client = AgentClient.getInstance();
      const latch = latchConnectFailed();

      // Fresh agent subscribe against the already-failed verdict → synchronous
      // fire (deferred). Must NOT throw a TDZ ReferenceError on the hoisted
      // `close` closure binding, and must degrade to the SSE agent path.
      const onToken = vi.fn();
      let pending: Promise<void>;
      expect(() => {
        pending = client.subscribeToEvents("session-B", { onToken });
      }).not.toThrow();

      await Promise.resolve();
      await Promise.resolve();

      expect(eventSourceInstances.some((es) => es.url.includes("/api/v1/events/session-B"))).toBe(
        true,
      );

      // Drive the SSE leg to terminal so its promise resolves.
      const agentEs = eventSourceInstances.find((es) => es.url.includes("/events/session-B"));
      agentEs?.onmessage?.({ data: "[DONE]" } as MessageEvent<string>);
      await expect(pending!).resolves.toBeUndefined();
      latch.close();
    });

    // --- H3: feed fallback resets connectivity so the WS can be retried -----

    it("(H3) after a feed fallback the next feed subscribe retries the WS (connectivity reset)", () => {
      const client = AgentClient.getInstance();

      const handle1 = client.subscribeToAccountStream({ onChange: vi.fn() }, { since: 0 });
      expect(wsInstances).toHaveLength(1);

      // Initial connect fails → feed fallback to SSE. The fallback MUST close the
      // WS feed handle so v2Stream nulls feedChannel and closeIfIdle resets
      // everOpened/connectFailed.
      wsInstances[0]?.drop();
      expect(eventSourceInstances).toHaveLength(1);

      // Tear down the first (SSE) subscription so there are zero subscriptions
      // and connectivity state is fully re-armed.
      handle1.close();

      // A brand-new subscribe must construct a FRESH WebSocket (not stay stuck on
      // the previously-failed verdict).
      const handle2 = client.subscribeToAccountStream({ onChange: vi.fn() }, { since: 0 });
      expect(wsInstances).toHaveLength(2);
      handle2.close();
    });

    // --- H2: onopen-then-immediate-close flap bounds to SSE fallback --------

    it("(H2) open→close within the stability window x3 falls back to SSE and stops reconnecting", () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      try {
        const client = AgentClient.getInstance();
        client.subscribeToAccountStream({ onChange: vi.fn() }, { since: 0 });
        expect(wsInstances).toHaveLength(1);

        // Flap: open then close within STABLE_OPEN_MS (15s), three times.
        // Each short-lived cycle increments the counter; the 3rd triggers the
        // forced fallback to SSE.
        for (let cycle = 0; cycle < 3; cycle += 1) {
          const ws = wsInstances[wsInstances.length - 1];
          ws?.open();
          // Stay open only ~1s (well under the 15s stability threshold).
          vi.advanceTimersByTime(1000);
          ws?.drop();
          // Let any scheduled reconnect fire so the next WS is constructed.
          vi.advanceTimersByTime(16000);
        }

        // After 3 short-lived closes we degrade to SSE.
        expect(eventSourceInstances).toHaveLength(1);
        expect(eventSourceInstances[0]?.url).toContain("/api/v1/stream");

        // No further reconnect WebSockets are constructed (the flap is bounded).
        const wsCountAfterFallback = wsInstances.length;
        vi.advanceTimersByTime(60000);
        expect(wsInstances.length).toBe(wsCountAfterFallback);
      } finally {
        vi.useRealTimers();
      }
    });

    it("(H2) a stable open (> threshold) that later drops reconnects without fallback and resets the counter", () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      try {
        const client = AgentClient.getInstance();
        client.subscribeToAccountStream({ onChange: vi.fn() }, { since: 0 });
        expect(wsInstances).toHaveLength(1);

        // Two short-lived closes first (counter = 2, still under MAX_SHORTLIVED).
        for (let cycle = 0; cycle < 2; cycle += 1) {
          const ws = wsInstances[wsInstances.length - 1];
          ws?.open();
          vi.advanceTimersByTime(1000);
          ws?.drop();
          vi.advanceTimersByTime(16000);
        }
        expect(eventSourceInstances).toHaveLength(0);

        // Now a STABLE open: stays open longer than STABLE_OPEN_MS, then drops.
        // This resets the short-lived counter and reconnects (no fallback).
        const stableWs = wsInstances[wsInstances.length - 1];
        stableWs?.open();
        vi.advanceTimersByTime(20000); // > 15s stability threshold
        stableWs?.drop();
        vi.advanceTimersByTime(16000); // let reconnect fire

        // Still on WS (a fresh reconnect), never fell back to SSE.
        expect(eventSourceInstances).toHaveLength(0);
        expect(wsInstances.length).toBeGreaterThanOrEqual(4);

        // Counter was reset: it now takes a fresh run of 3 short-lived closes to
        // fall back. Two more short-lived closes must NOT yet fall back.
        for (let cycle = 0; cycle < 2; cycle += 1) {
          const ws = wsInstances[wsInstances.length - 1];
          ws?.open();
          vi.advanceTimersByTime(1000);
          ws?.drop();
          vi.advanceTimersByTime(16000);
        }
        expect(eventSourceInstances).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
