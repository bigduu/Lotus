import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildPromptInspectorContextDetails,
  buildPromptSnapshotSections,
  useSystemPromptContent,
} from "../useSystemPromptContent";

const mockFindPresetById = vi.fn();
const mockGetSessionSystemPrompt = vi.fn();

vi.mock("@shared/services/SystemPromptService", () => ({
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
      project_context:
        "<!-- BAMBOO_PROJECT_CONTEXT_START -->\nProject ID: project-1\nProject path: /repo/zenith\n<!-- BAMBOO_PROJECT_CONTEXT_END -->",
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
      "project",
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

  it("joins authoritative Project and session fields without parsing prompt context", () => {
    const details = buildPromptInspectorContextDetails({
      projectPath: "/repo/zenith",
      sessionWorkspacePath: "/repo/zenith-worktree",
      resourceRevision: 7,
    });

    expect(details).toEqual({
      projectPath: "/repo/zenith",
      sessionWorkspacePath: "/repo/zenith-worktree",
      effectiveWorkspacePath: "/repo/zenith-worktree",
      resourceRevision: 7,
      usesProjectPathFallback: false,
    });
  });

  it("keeps Project and Workspace context sections independent when either field is missing", () => {
    const common = {
      session_id: "session-1",
      base_system_prompt: "Base prompt",
      effective_system_prompt: "Effective prompt",
    };

    expect(
      buildPromptSnapshotSections({ ...common, project_context: "Project context" }).map(
        (section) => section.key,
      ),
    ).toEqual(["base", "project", "effective"]);
    expect(
      buildPromptSnapshotSections({ ...common, workspace_context: "Workspace context" }).map(
        (section) => section.key,
      ),
    ).toEqual(["base", "workspace", "effective"]);
  });

  it("uses the Project path as effective workspace when the session has no workspace", () => {
    const details = buildPromptInspectorContextDetails({
      projectPath: "/repo/zenith",
      sessionWorkspacePath: null,
      resourceRevision: 8,
    });

    expect(details.sessionWorkspacePath).toBeNull();
    expect(details.effectiveWorkspacePath).toBe("/repo/zenith");
    expect(details.usesProjectPathFallback).toBe(true);
  });

  it("degrades safely for legacy sessions with missing structured Project fields", () => {
    expect(buildPromptInspectorContextDetails()).toEqual({
      projectPath: null,
      sessionWorkspacePath: null,
      effectiveWorkspacePath: null,
      resourceRevision: null,
      usesProjectPathFallback: false,
    });
  });

  it("loads prompt snapshot and exposes sections when enhanced prompt is requested", async () => {
    mockGetSessionSystemPrompt.mockResolvedValue({
      session_id: "session-1",
      base_system_prompt: "Base prompt",
      enhancement_prompt: "Enhancement layer",
      project_context: "Project context",
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
      expect(result.current.snapshotSections.map((section) => section.key)).toContain("project");
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
