import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api", () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

import { SubagentProfileService, subagentProfileService } from "../SubagentProfileService";
import type { SubagentProfileListResponse } from "../types";

describe("SubagentProfileService", () => {
  let mockApiClient: { get: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    const apiModule = await import("../../api");
    mockApiClient = apiModule.apiClient as unknown as { get: ReturnType<typeof vi.fn> };
  });

  it("issues a GET to the bare `subagent_profiles` path so the apiClient /v1 prefix is preserved", async () => {
    const payload: SubagentProfileListResponse = {
      profiles: [
        {
          id: "general-purpose",
          display_name: "General Purpose",
          description: "Default role.",
          tools: { mode: "inherit" },
        },
      ],
      fallback_id: "general-purpose",
      count: 1,
    };
    mockApiClient.get.mockResolvedValueOnce(payload);

    const result = await subagentProfileService.listProfiles();

    expect(mockApiClient.get).toHaveBeenCalledTimes(1);
    expect(mockApiClient.get).toHaveBeenCalledWith("subagent_profiles");
    expect(result).toEqual(payload);
  });

  it("returns the full payload (profiles + fallback_id + count) untouched", async () => {
    const payload: SubagentProfileListResponse = {
      profiles: [
        {
          id: "researcher",
          display_name: "Researcher",
          description: "Read-only investigator.",
          tools: { mode: "allowlist", allow: ["Read", "Grep"] },
          model_hint: null,
          default_responsibility: null,
          ui: { icon: "🔎", color: "blue" },
        },
        {
          id: "coder",
          display_name: "Coder",
          description: "Implements changes.",
          tools: { mode: "denylist", deny: ["SubSession"] },
          model_hint: "anthropic/claude-3-5-sonnet",
          default_responsibility: "Implement the requested change.",
          ui: { icon: "💻", color: "green" },
        },
      ],
      fallback_id: "general-purpose",
      count: 2,
    };
    mockApiClient.get.mockResolvedValueOnce(payload);

    const service = new SubagentProfileService();
    const result = await service.listProfiles();

    expect(result.profiles).toHaveLength(2);
    expect(result.fallback_id).toBe("general-purpose");
    expect(result.count).toBe(2);
    expect(result.profiles[0].tools).toEqual({ mode: "allowlist", allow: ["Read", "Grep"] });
    expect(result.profiles[1].tools).toEqual({ mode: "denylist", deny: ["SubSession"] });
  });

  it("propagates errors from the underlying apiClient", async () => {
    mockApiClient.get.mockRejectedValueOnce(new Error("network down"));

    await expect(subagentProfileService.listProfiles()).rejects.toThrow("network down");
  });
});
