import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UserSystemPrompt } from "../../../types/chat";
import { createSliceHarness } from "./sliceHarness";

const {
  mockGetSystemPromptPresets,
  mockCreateSystemPromptPreset,
  mockUpdateSystemPromptPreset,
  mockDeleteSystemPromptPreset,
} = vi.hoisted(() => ({
  mockGetSystemPromptPresets: vi.fn(),
  mockCreateSystemPromptPreset: vi.fn(),
  mockUpdateSystemPromptPreset: vi.fn(),
  mockDeleteSystemPromptPreset: vi.fn(),
}));

vi.mock("../../../services/SystemPromptService", () => ({
  SystemPromptService: {
    getInstance: () => ({
      getSystemPromptPresets: mockGetSystemPromptPresets,
      createSystemPromptPreset: mockCreateSystemPromptPreset,
      updateSystemPromptPreset: mockUpdateSystemPromptPreset,
      deleteSystemPromptPreset: mockDeleteSystemPromptPreset,
    }),
  },
}));

type PromptSlice = {
  systemPrompts: UserSystemPrompt[];
  lastSelectedPromptId: string | null;
  loadSystemPrompts: () => Promise<void>;
  addSystemPrompt: (prompt: Omit<UserSystemPrompt, "id">) => Promise<void>;
  updateSystemPrompt: (prompt: UserSystemPrompt) => Promise<void>;
  deleteSystemPrompt: (promptId: string) => Promise<void>;
  setLastSelectedPromptId: (promptId: string) => void;
};

const LEGACY_CUSTOM_PROMPTS_LS_KEY = "copilot_custom_system_prompts_v2";
const LEGACY_PROMPTS_MIGRATED_LS_KEY =
  "copilot_custom_system_prompts_v2_migrated_to_backend";
const LAST_SELECTED_PROMPT_ID_LS_KEY = "copilot_last_selected_prompt_id";

const loadSlice = async () => {
  const module = await import("../promptSlice");
  return module.createPromptSlice;
};

describe("promptSlice behavior", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("loads backend prompts and keeps selected prompt from localStorage", async () => {
    mockGetSystemPromptPresets.mockResolvedValueOnce([
      { id: "p1", name: "Preset 1", content: "hello" },
    ]);
    localStorage.setItem(LAST_SELECTED_PROMPT_ID_LS_KEY, "p1");
    localStorage.setItem(LEGACY_PROMPTS_MIGRATED_LS_KEY, "1");

    const createPromptSlice = await loadSlice();
    const harness = createSliceHarness<PromptSlice>(createPromptSlice as any);
    await harness.getState().loadSystemPrompts();

    expect(harness.getState().lastSelectedPromptId).toBe("p1");
    expect(harness.getState().systemPrompts).toEqual([
      { id: "p1", name: "Preset 1", content: "hello" },
    ]);
  });

  it("falls back to default prompts when backend has no presets", async () => {
    mockGetSystemPromptPresets.mockResolvedValue([]);
    localStorage.setItem(LEGACY_PROMPTS_MIGRATED_LS_KEY, "1");

    const createPromptSlice = await loadSlice();
    const harness = createSliceHarness<PromptSlice>(createPromptSlice as any);
    await harness.getState().loadSystemPrompts();

    expect(harness.getState().systemPrompts[0]?.id).toBe("general_assistant");
  });

  it("merges legacy prompts when migration is incomplete", async () => {
    localStorage.setItem(
      LEGACY_CUSTOM_PROMPTS_LS_KEY,
      JSON.stringify([
        {
          id: "legacy_prompt",
          name: "Legacy Prompt",
          content: "legacy content",
          description: "legacy",
        },
      ]),
    );
    mockGetSystemPromptPresets.mockResolvedValueOnce([
      { id: "general_assistant", name: "Bodhi", content: "default" },
    ]);
    // Force migration to keep marker unset so merge path runs.
    mockCreateSystemPromptPreset.mockRejectedValueOnce(new Error("migration failed"));

    const createPromptSlice = await loadSlice();
    const harness = createSliceHarness<PromptSlice>(createPromptSlice as any);
    await harness.getState().loadSystemPrompts();

    expect(harness.getState().systemPrompts.map((p) => p.id)).toEqual(
      expect.arrayContaining(["general_assistant", "legacy_prompt"]),
    );
    expect(localStorage.getItem(LEGACY_PROMPTS_MIGRATED_LS_KEY)).not.toBe("1");
  });

  it("supports add, update, and delete actions", async () => {
    localStorage.setItem(LEGACY_PROMPTS_MIGRATED_LS_KEY, "1");
    mockGetSystemPromptPresets.mockResolvedValue([
      { id: "p1", name: "Preset 1", content: "hello" },
    ]);
    mockCreateSystemPromptPreset.mockResolvedValue({ id: "new_prompt" });
    mockUpdateSystemPromptPreset.mockResolvedValue({});
    mockDeleteSystemPromptPreset.mockResolvedValue({});

    const createPromptSlice = await loadSlice();
    const harness = createSliceHarness<PromptSlice>(createPromptSlice as any);

    await harness.getState().addSystemPrompt({
      name: "New Prompt",
      content: "new content",
      description: "desc",
      isDefault: false,
    });
    expect(mockCreateSystemPromptPreset).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "new_prompt",
        name: "New Prompt",
        content: "new content",
      }),
    );

    await harness.getState().updateSystemPrompt({
      id: "p1",
      name: "Updated",
      content: "updated",
    });
    expect(mockUpdateSystemPromptPreset).toHaveBeenCalledWith({
      id: "p1",
      name: "Updated",
      content: "updated",
    });

    await harness.getState().deleteSystemPrompt("p1");
    expect(mockDeleteSystemPromptPreset).toHaveBeenCalledWith("p1");
  });

  it("propagates add/update/delete errors", async () => {
    localStorage.setItem(LEGACY_PROMPTS_MIGRATED_LS_KEY, "1");
    mockGetSystemPromptPresets.mockResolvedValue([]);
    mockCreateSystemPromptPreset.mockRejectedValueOnce(new Error("add failed"));
    mockUpdateSystemPromptPreset.mockRejectedValueOnce(new Error("update failed"));
    mockDeleteSystemPromptPreset.mockRejectedValueOnce(new Error("delete failed"));

    const createPromptSlice = await loadSlice();
    const harness = createSliceHarness<PromptSlice>(createPromptSlice as any);

    await expect(
      harness.getState().addSystemPrompt({
        name: "Fail Add",
        content: "x",
      } as Omit<UserSystemPrompt, "id">),
    ).rejects.toThrow("add failed");

    await expect(
      harness.getState().updateSystemPrompt({
        id: "p1",
        name: "Fail Update",
        content: "x",
      }),
    ).rejects.toThrow("update failed");

    await expect(harness.getState().deleteSystemPrompt("p1")).rejects.toThrow(
      "delete failed",
    );
  });

  it("persists last selected prompt id", async () => {
    const createPromptSlice = await loadSlice();
    const harness = createSliceHarness<PromptSlice>(createPromptSlice as any);

    harness.getState().setLastSelectedPromptId("preset-x");
    expect(harness.getState().lastSelectedPromptId).toBe("preset-x");
    expect(localStorage.getItem(LAST_SELECTED_PROMPT_ID_LS_KEY)).toBe(
      "preset-x",
    );
  });
});
