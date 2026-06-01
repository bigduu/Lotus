import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAgentApiGet, mockAgentApiPost, mockAgentApiPatch, mockAgentApiDelete } = vi.hoisted(
  () => ({
    mockAgentApiGet: vi.fn(),
    mockAgentApiPost: vi.fn(),
    mockAgentApiPatch: vi.fn(),
    mockAgentApiDelete: vi.fn(),
  }),
);

vi.mock("../../../../services/api", () => ({
  agentApiClient: {
    get: mockAgentApiGet,
    post: mockAgentApiPost,
    patch: mockAgentApiPatch,
    delete: mockAgentApiDelete,
  },
}));

import type { UserSystemPrompt } from "@shared/types/chat";
import { SystemPromptService } from "../SystemPromptService";

describe("SystemPromptService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (SystemPromptService as any).instance = undefined;
    localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("cleans deprecated localStorage keys once when creating singleton", () => {
    localStorage.setItem("system_prompt", "legacy prompt");
    localStorage.setItem("system_prompt_selected_id", "legacy-id");

    const first = SystemPromptService.getInstance();
    const second = SystemPromptService.getInstance();

    expect(first).toBe(second);
    expect(localStorage.getItem("system_prompt")).toBeNull();
    expect(localStorage.getItem("system_prompt_selected_id")).toBeNull();
  });

  it("maps backend presets and filters invalid ids", async () => {
    mockAgentApiGet.mockResolvedValueOnce({
      prompts: [
        {
          id: "preset-1",
          name: "Preset One",
          description: "desc",
          content: "body",
          is_default: true,
        },
        {
          id: "   ",
          name: "Invalid",
          content: "ignored",
        },
      ],
    });

    const service = SystemPromptService.getInstance();
    await expect(service.getSystemPromptPresets()).resolves.toEqual([
      {
        id: "preset-1",
        name: "Preset One",
        description: "desc",
        content: "body",
        isDefault: true,
      },
    ]);
    expect(mockAgentApiGet).toHaveBeenCalledWith("prompt-presets");
  });

  it("falls back to default prompts when backend fails", async () => {
    mockAgentApiGet.mockRejectedValueOnce(new Error("boom"));

    const service = SystemPromptService.getInstance();
    const presets = await service.getSystemPromptPresets();

    expect(presets.length).toBeGreaterThan(0);
    expect(presets[0]?.id).toBe("general_assistant");
    expect(presets[0]?.isDefault).toBe(true);
  });

  it("creates prompt preset with trimmed id and description", async () => {
    mockAgentApiPost.mockResolvedValueOnce({
      prompt: {
        id: "custom-id",
        name: "Custom",
        description: "custom desc",
        content: "prompt body",
        is_default: false,
      },
    });

    const service = SystemPromptService.getInstance();
    const created = await service.createSystemPromptPreset({
      id: "  custom-id  ",
      name: "Custom",
      description: "custom desc",
      content: "prompt body",
    });

    expect(mockAgentApiPost).toHaveBeenCalledWith("prompt-presets", {
      id: "custom-id",
      name: "Custom",
      description: "custom desc",
      content: "prompt body",
    });
    expect(created).toEqual({
      id: "custom-id",
      name: "Custom",
      description: "custom desc",
      content: "prompt body",
      isDefault: false,
    });
  });

  it("throws if backend misses created prompt payload", async () => {
    mockAgentApiPost.mockResolvedValueOnce({});

    const service = SystemPromptService.getInstance();
    await expect(
      service.createSystemPromptPreset({
        name: "No Return",
        content: "x",
      }),
    ).rejects.toThrow("Backend did not return created prompt preset");
  });

  it("updates and deletes prompt presets with encoded ids", async () => {
    mockAgentApiPatch.mockResolvedValueOnce({
      prompt: {
        id: "id with/slash",
        name: "Updated",
        content: "updated body",
      },
    });

    const service = SystemPromptService.getInstance();
    const updated = await service.updateSystemPromptPreset({
      id: "id with/slash",
      name: "Updated",
      content: "updated body",
    } as UserSystemPrompt);
    await service.deleteSystemPromptPreset("id with/slash");

    expect(mockAgentApiPatch).toHaveBeenCalledWith("prompt-presets/id%20with%2Fslash", {
      name: "Updated",
      content: "updated body",
      description: undefined,
    });
    expect(mockAgentApiDelete).toHaveBeenCalledWith("prompt-presets/id%20with%2Fslash");
    expect(updated).toEqual({
      id: "id with/slash",
      name: "Updated",
      content: "updated body",
      description: undefined,
      isDefault: false,
    });
  });

  it("resolves current prompt content from selected or default preset", async () => {
    mockAgentApiGet.mockResolvedValueOnce({
      prompts: [
        { id: "selected", name: "Selected", content: "selected-content" },
        { id: "default", name: "Default", content: "default-content", is_default: true },
      ],
    });

    const service = SystemPromptService.getInstance();
    await expect(service.getCurrentSystemPromptContent("selected")).resolves.toBe(
      "selected-content",
    );

    mockAgentApiGet.mockResolvedValueOnce({
      prompts: [{ id: "other", name: "Other", content: "other-content" }],
    });
    mockAgentApiGet.mockResolvedValueOnce({
      prompts: [
        { id: "other", name: "Other", content: "other-content" },
        { id: "default", name: "Default", content: "default-content", is_default: true },
      ],
    });

    await expect(service.getCurrentSystemPromptContent("missing")).resolves.toBe("default-content");
  });
});
