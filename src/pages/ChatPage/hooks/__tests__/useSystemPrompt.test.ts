import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useSystemPrompt } from "../useSystemPrompt";
import { SystemPromptService } from "@shared/services/SystemPromptService";

vi.mock("@shared/services/SystemPromptService");

describe("useSystemPrompt", () => {
  let mockService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockService = {
      getSystemPromptPresets: vi.fn(),
      findPresetById: vi.fn(),
      getCurrentSystemPromptContent: vi.fn(),
    };
    vi.mocked(SystemPromptService.getInstance).mockReturnValue(mockService);
  });

  describe("preset loading", () => {
    it("should load presets on mount", async () => {
      const presets = [{ id: "1", name: "Default", content: "Test" }];
      mockService.getSystemPromptPresets.mockResolvedValue(presets);

      const { result } = renderHook(() => useSystemPrompt());

      expect(result.current.isLoadingPresets).toBe(true);

      await waitFor(() => {
        expect(result.current.isLoadingPresets).toBe(false);
      });

      expect(result.current.systemPromptPresets).toEqual(presets);
    });

    it("should handle preset loading error", async () => {
      mockService.getSystemPromptPresets.mockRejectedValue(new Error("Failed"));

      const { result } = renderHook(() => useSystemPrompt());

      await waitFor(() => {
        expect(result.current.presetsError).toBe("Failed");
      });
    });

    it("should refresh presets", async () => {
      mockService.getSystemPromptPresets
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "1", name: "New" }]);

      const { result } = renderHook(() => useSystemPrompt());

      await waitFor(() => {
        expect(result.current.systemPromptPresets).toEqual([]);
      });

      await result.current.refreshPresets();

      await waitFor(() => {
        expect(result.current.systemPromptPresets).toEqual([{ id: "1", name: "New" }]);
      });
    });
  });

  describe("current prompt info", () => {
    it("should not load when ID is null", async () => {
      mockService.getSystemPromptPresets.mockResolvedValue([]);

      const { result } = renderHook(() => useSystemPrompt(null));

      await waitFor(() => {
        expect(result.current.isLoadingCurrentInfo).toBe(false);
      });

      expect(result.current.currentSystemPromptInfo).toBe(null);
    });

    it("should load current info when ID provided", async () => {
      const info = { id: "1", name: "Test", content: "Content" };
      mockService.getSystemPromptPresets.mockResolvedValue([]);
      mockService.findPresetById.mockResolvedValue(info);

      const { result } = renderHook(() => useSystemPrompt("1"));

      await waitFor(() => {
        expect(result.current.currentSystemPromptInfo).toEqual(info);
      });
    });

    it("should handle current info error", async () => {
      mockService.getSystemPromptPresets.mockResolvedValue([]);
      mockService.findPresetById.mockRejectedValue(new Error("Not found"));

      const { result } = renderHook(() => useSystemPrompt("1"));

      await waitFor(() => {
        expect(result.current.currentInfoError).toBe("Not found");
      });
    });

    it("should reload when ID changes", async () => {
      mockService.getSystemPromptPresets.mockResolvedValue([]);
      mockService.findPresetById
        .mockResolvedValueOnce({ id: "1", name: "Test 1" })
        .mockResolvedValueOnce({ id: "2", name: "Test 2" });

      const { result, rerender } = renderHook(({ id }) => useSystemPrompt(id), {
        initialProps: { id: "1" },
      });

      await waitFor(() => {
        expect(result.current.currentSystemPromptInfo).toEqual({ id: "1", name: "Test 1" });
      });

      rerender({ id: "2" });

      await waitFor(() => {
        expect(result.current.currentSystemPromptInfo).toEqual({ id: "2", name: "Test 2" });
      });
    });
  });

  describe("methods", () => {
    it("should call findPresetById", async () => {
      const preset = { id: "1", name: "Test" };
      mockService.getSystemPromptPresets.mockResolvedValue([]);
      mockService.findPresetById.mockResolvedValue(preset);

      const { result } = renderHook(() => useSystemPrompt());

      await waitFor(() => expect(result.current.isLoadingPresets).toBe(false));

      const found = await result.current.findPresetById("1");

      expect(found).toEqual(preset);
    });

    it("should call getCurrentSystemPromptContent", async () => {
      mockService.getSystemPromptPresets.mockResolvedValue([]);
      mockService.getCurrentSystemPromptContent.mockResolvedValue("Content");

      const { result } = renderHook(() => useSystemPrompt());

      await waitFor(() => expect(result.current.isLoadingPresets).toBe(false));

      const content = await result.current.getCurrentSystemPromptContent("1");

      expect(content).toBe("Content");
    });
  });
});
