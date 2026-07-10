import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api", () => ({
  agentApiClient: {
    get: vi.fn(),
    put: vi.fn(),
  },
}));

import {
  getNotificationPreferences,
  setNotificationPreferences,
  type NotificationPreferences,
} from "../notificationPreferencesApi";

describe("notificationPreferencesApi", () => {
  let mockClient: {
    get: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    const apiModule = await import("../../api");
    mockClient = apiModule.agentApiClient as unknown as typeof mockClient;
  });

  it("GETs preferences and maps snake_case -> camelCase", async () => {
    mockClient.get.mockResolvedValueOnce({
      enabled: true,
      on_clarification: false,
      on_tool_approval: true,
      on_context_pressure: false,
      on_subagent_complete: true,
      on_background_task_complete: false,
      on_run_complete: true,
      on_run_failed: false,
    });

    const prefs = await getNotificationPreferences();

    expect(mockClient.get).toHaveBeenCalledWith("notifications/preferences");
    expect(prefs).toEqual<NotificationPreferences>({
      enabled: true,
      onClarification: false,
      onToolApproval: true,
      onContextPressure: false,
      onSubAgentComplete: true,
      onBackgroundTaskComplete: false,
      onRunComplete: true,
      onRunFailed: false,
    });
  });

  it("PUTs preferences mapping camelCase -> snake_case and returns saved", async () => {
    const next: NotificationPreferences = {
      enabled: false,
      onClarification: true,
      onToolApproval: false,
      onContextPressure: true,
      onSubAgentComplete: false,
      onBackgroundTaskComplete: true,
      onRunComplete: false,
      onRunFailed: true,
    };

    mockClient.put.mockResolvedValueOnce({
      enabled: false,
      on_clarification: true,
      on_tool_approval: false,
      on_context_pressure: true,
      on_subagent_complete: false,
      on_background_task_complete: true,
      on_run_complete: false,
      on_run_failed: true,
    });

    const saved = await setNotificationPreferences(next);

    expect(mockClient.put).toHaveBeenCalledWith("notifications/preferences", {
      enabled: false,
      on_clarification: true,
      on_tool_approval: false,
      on_context_pressure: true,
      on_subagent_complete: false,
      on_background_task_complete: true,
      on_run_complete: false,
      on_run_failed: true,
    });
    expect(saved).toEqual(next);
  });
});
