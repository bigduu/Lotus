import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildPromptSnapshotSections, useSystemPromptContent } from "../useSystemPromptContent";

const mockFindPresetById = vi.fn();
const mockGetSessionSystemPrompt = vi.fn();

vi.mock("../../../services/SystemPromptService", () => ({
  SystemPromptService: {
    getInstance: () => ({
      findPresetById: mockFindPresetById,
    }),
  },
}));

vi.mock("@services/chat/AgentService", () => ({
  AgentClient: {
    getInstance: () => ({
      getSessionSystemPrompt: mockGetSessionSystemPrompt,
    }),
  },
}));

describe("useSystemPromptContent", () => {
  const currentChat = {
    id: "session-1",
    config: {
      systemPromptId: "preset-1",
      workspacePath: "/workspace/project",
    },
  };

  const message = {
    id: "system-message-1",
    createdAt: "2026-04-03T00:00:00Z",
    role: "system" as const,
    content: "Persisted system prompt",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindPresetById.mockResolvedValue({
      id: "preset-1",
      name: "Default",
      content: "Base prompt from preset",
      description: "Preset description",
    });
  });

  it("builds sectioned prompt snapshot data from backend fields", () => {
    const sections = buildPromptSnapshotSections({
      session_id: "session-1",
      base_system_prompt: "Base prompt",
      enhancement_prompt: "Enhancement layer",
      workspace_context: "Workspace context",
      instruction_context: "Instruction layer",
      env_context: "Env context",
      skill_context: "Skill context",
      tool_guide_context: "Tool guide",
      dream_notebook: "Dream notebook",
      session_memory_note: "Session memory note",
      external_memory: "External memory",
      task_list: "Task list",
      effective_system_prompt: "Effective prompt",
    });

    expect(sections.map((section) => section.key)).toEqual([
      "base",
      "enhancement",
      "workspace",
      "instruction",
      "env",
      "skills",
      "toolGuide",
      "dream",
      "sessionMemory",
      "externalMemory",
      "taskList",
      "effective",
    ]);
  });

  it("loads prompt snapshot and exposes sections when enhanced prompt is requested", async () => {
    mockGetSessionSystemPrompt.mockResolvedValue({
      session_id: "session-1",
      base_system_prompt: "Base prompt",
      enhancement_prompt: "Enhancement layer",
      workspace_context: "Workspace context",
      instruction_context: "Instruction layer",
      env_context: "Env context",
      skill_context: "Skill context",
      tool_guide_context: "Tool guide",
      dream_notebook: "Dream notebook",
      session_memory_note: "Session memory note",
      external_memory: "External memory",
      task_list: "Task list",
      effective_system_prompt: "Effective prompt",
    });

    const { result } = renderHook(() =>
      useSystemPromptContent({
        currentChat,
        message,
        systemPrompts: [],
      }),
    );

    await waitFor(() => {
      expect(result.current.basePrompt).toBe("Base prompt from preset");
    });

    await act(async () => {
      await result.current.loadEnhancedPrompt();
    });

    await waitFor(() => {
      expect(result.current.showEnhanced).toBe(true);
      expect(result.current.promptToDisplay).toBe("Effective prompt");
      expect(result.current.snapshotSections.map((section) => section.key)).toContain(
        "instruction",
      );
      expect(result.current.snapshotSections.map((section) => section.key)).toContain(
        "sessionMemory",
      );
    });
  });

  it("omits empty memory-related snapshot sections while preserving non-empty ones", () => {
    const sections = buildPromptSnapshotSections({
      session_id: "session-1",
      base_system_prompt: "Base prompt",
      dream_notebook: "   ",
      session_memory_note: "",
      external_memory: "Memory layers block",
      effective_system_prompt: "Effective prompt",
    });

    expect(sections.map((section) => section.key)).toEqual(["base", "externalMemory", "effective"]);
    expect(sections.find((section) => section.key === "externalMemory")?.content).toBe(
      "Memory layers block",
    );
  });
});
