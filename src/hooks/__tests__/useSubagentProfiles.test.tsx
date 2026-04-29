import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/subagent", () => ({
  subagentProfileService: {
    listProfiles: vi.fn(),
  },
}));

import { useSubagentProfiles } from "../useSubagentProfiles";
import { subagentProfileService } from "../../services/subagent";

const mockListProfiles = subagentProfileService.listProfiles as unknown as ReturnType<typeof vi.fn>;

const samplePayload = {
  profiles: [
    {
      id: "researcher",
      display_name: "Researcher",
      description: "Read-only investigator.",
      tools: { mode: "allowlist" as const, allow: ["Read", "Grep"] },
      ui: { icon: "🔎", color: "blue" },
    },
    {
      id: "coder",
      display_name: "Coder",
      description: "Implements changes.",
      tools: { mode: "denylist" as const, deny: ["SubSession"] },
    },
  ],
  fallback_id: "general-purpose",
  count: 2,
};

describe("useSubagentProfiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("auto-fetches the catalogue on mount and exposes it via state", async () => {
    mockListProfiles.mockResolvedValueOnce(samplePayload);

    const { result } = renderHook(() => useSubagentProfiles());

    // Initial render: empty + not yet loaded.
    expect(result.current.profiles).toEqual([]);
    expect(result.current.fallbackId).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockListProfiles).toHaveBeenCalledTimes(1);
    expect(result.current.profiles).toHaveLength(2);
    expect(result.current.fallbackId).toBe("general-purpose");
    expect(result.current.error).toBeNull();
  });

  it("exposes a byId Map for O(1) lookup", async () => {
    mockListProfiles.mockResolvedValueOnce(samplePayload);

    const { result } = renderHook(() => useSubagentProfiles());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.byId.get("researcher")?.display_name).toBe("Researcher");
    expect(result.current.byId.get("coder")?.tools).toEqual({
      mode: "denylist",
      deny: ["SubSession"],
    });
    expect(result.current.byId.get("does-not-exist")).toBeUndefined();
  });

  it("captures errors and clears them after a successful refresh", async () => {
    mockListProfiles.mockRejectedValueOnce(new Error("boom"));

    const { result } = renderHook(() => useSubagentProfiles());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toEqual(new Error("boom"));
    expect(result.current.profiles).toEqual([]);

    // Now arrange a successful refresh.
    mockListProfiles.mockResolvedValueOnce(samplePayload);
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.profiles).toHaveLength(2);
  });

  it("does NOT fetch when `enabled: false`", async () => {
    const { result } = renderHook(() => useSubagentProfiles({ enabled: false }));

    // Give microtasks a chance to flush.
    await Promise.resolve();

    expect(mockListProfiles).not.toHaveBeenCalled();
    expect(result.current.profiles).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("re-fetches when `refreshKey` changes", async () => {
    mockListProfiles.mockResolvedValue(samplePayload);

    const { result, rerender } = renderHook(
      ({ refreshKey }: { refreshKey: number }) => useSubagentProfiles({ refreshKey }),
      { initialProps: { refreshKey: 1 } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockListProfiles).toHaveBeenCalledTimes(1);

    rerender({ refreshKey: 2 });
    await waitFor(() => expect(mockListProfiles).toHaveBeenCalledTimes(2));
  });
});
