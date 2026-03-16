import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { WorkspaceService } from "../WorkspaceService";

describe("WorkspaceService", () => {
  let mockApiClient: {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    const apiModule = await import("../../api");
    mockApiClient = apiModule.apiClient;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("validates paths and browse/add endpoints", async () => {
    mockApiClient.post
      .mockResolvedValueOnce({ path: "/ws", is_valid: true })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        current_path: "/",
        folders: [{ name: "ws", path: "/ws" }],
      });

    const service = new WorkspaceService();
    await expect(service.validatePath("/ws")).resolves.toEqual({
      path: "/ws",
      is_valid: true,
    });
    await expect(
      service.addRecent("/ws", { workspace_name: "Workspace" }),
    ).resolves.toBeUndefined();
    await expect(service.browseFolder("/")).resolves.toEqual({
      current_path: "/",
      folders: [{ name: "ws", path: "/ws" }],
    });

    expect(mockApiClient.post).toHaveBeenNthCalledWith(
      1,
      "workspace/validate",
      { path: "/ws" },
    );
    expect(mockApiClient.post).toHaveBeenNthCalledWith(
      2,
      "workspace/recent",
      { path: "/ws", metadata: { workspace_name: "Workspace" } },
    );
    expect(mockApiClient.post).toHaveBeenNthCalledWith(
      3,
      "workspace/browse-folder",
      { path: "/" },
    );
  });

  it("caches getRecent results and reuses cache", async () => {
    const recent = [{ path: "/a", is_valid: true }];
    mockApiClient.get.mockResolvedValueOnce(recent);

    const service = new WorkspaceService();
    await expect(service.getRecent()).resolves.toEqual(recent);
    await expect(service.getRecent()).resolves.toEqual(recent);

    expect(mockApiClient.get).toHaveBeenCalledTimes(1);
    expect(mockApiClient.get).toHaveBeenCalledWith(
      "workspace/recent",
      expect.any(Object),
    );
  });

  it("falls back to cached recent workspaces when refresh fails", async () => {
    const cached = [{ path: "/a", is_valid: true }];
    mockApiClient.get.mockResolvedValueOnce(cached);
    mockApiClient.get.mockRejectedValueOnce(new Error("offline"));

    const service = new WorkspaceService({ cacheTimeoutMs: -1 });
    await service.getRecent();

    await expect(service.getRecent()).resolves.toEqual(cached);
    expect(console.error).toHaveBeenCalled();
  });

  it("rethrows getRecent error when cache is empty", async () => {
    mockApiClient.get.mockRejectedValueOnce(new Error("offline"));

    const service = new WorkspaceService();
    await expect(service.getRecent()).rejects.toThrow("offline");
  });

  it("updates local cache on removeRecent and clearRecent", async () => {
    const service = new WorkspaceService();
    mockApiClient.get.mockResolvedValueOnce([
      { path: "/a", is_valid: true },
      { path: "/b", is_valid: true },
    ]);
    mockApiClient.get.mockResolvedValueOnce([{ path: "/b", is_valid: true }]);

    await service.removeRecent("/a");
    await expect(service.getRecent()).resolves.toEqual([
      { path: "/b", is_valid: true },
    ]);
    expect(mockApiClient.get).toHaveBeenCalledTimes(1);

    await service.clearRecent();
    await expect(service.getRecent()).resolves.toEqual([
      { path: "/b", is_valid: true },
    ]);
    expect(mockApiClient.get).toHaveBeenCalledTimes(2);
  });

  it("merges and sorts combined suggestions with dedupe", async () => {
    const service = new WorkspaceService();
    vi.spyOn(service, "getPathSuggestions").mockResolvedValue({
      suggestions: [
        { path: "/b", name: "B", suggestion_type: "common" },
        { path: "/a", name: "A", suggestion_type: "recent" },
      ],
    });
    vi.spyOn(service, "getRecent").mockResolvedValue([
      { path: "/a", is_valid: true, workspace_name: "A Recent" },
      { path: "/c", is_valid: true, workspace_name: "C Recent" },
    ]);

    const combined = await service.getCombinedSuggestions();

    expect(combined.map((workspace) => workspace.path)).toEqual([
      "/a",
      "/c",
      "/b",
    ]);
  });

  it("returns health status with cache info on success and failure", async () => {
    const service = new WorkspaceService();
    mockApiClient.get
      .mockResolvedValueOnce([{ path: "/a", is_valid: true }])
      .mockResolvedValueOnce([{ path: "/a", is_valid: true }])
      .mockRejectedValueOnce(new Error("network down"));

    await service.getRecent();

    const healthy = await service.healthCheck();
    expect(healthy.available).toBe(true);
    expect(healthy.cacheValid).toBe(true);
    expect(healthy.recentCount).toBe(1);

    const unhealthy = await service.healthCheck();
    expect(unhealthy).toMatchObject({
      available: false,
      cacheValid: true,
      recentCount: 1,
      error: "network down",
    });
  });

  it("lists workspace files with default and custom options", async () => {
    mockApiClient.post.mockResolvedValue([]);

    const service = new WorkspaceService();
    await service.listWorkspaceFiles("/ws");
    await service.listWorkspaceFiles("/ws", {
      max_depth: 5,
      max_entries: 20,
      include_hidden: true,
    });

    expect(mockApiClient.post).toHaveBeenNthCalledWith(1, "workspace/files", {
      path: "/ws",
      max_depth: 3,
      max_entries: 500,
      include_hidden: false,
    });
    expect(mockApiClient.post).toHaveBeenNthCalledWith(2, "workspace/files", {
      path: "/ws",
      max_depth: 5,
      max_entries: 20,
      include_hidden: true,
    });
  });
});
