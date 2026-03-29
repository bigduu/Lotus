import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api", () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

import { SkillService, skillService } from "../SkillService";

describe("SkillService", () => {
  let mockApiClient: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const apiModule = await import("../../api");
    mockApiClient = apiModule.apiClient;
  });

  it("lists skills without filters", async () => {
    mockApiClient.get.mockResolvedValueOnce({ skills: [], total: 0 });

    await skillService.listSkills();

    expect(mockApiClient.get).toHaveBeenCalledWith("skills");
  });

  it("lists skills with search and refresh query params", async () => {
    mockApiClient.get.mockResolvedValueOnce({ skills: [], total: 0 });

    const service = new SkillService();
    await service.listSkills({ search: "agent skill" }, true);

    expect(mockApiClient.get).toHaveBeenCalledWith("skills?search=agent+skill&refresh=true");
  });

  it("gets a single skill by id", async () => {
    mockApiClient.get.mockResolvedValueOnce({ id: "s1", name: "Skill" });

    await skillService.getSkill("s1");

    expect(mockApiClient.get).toHaveBeenCalledWith("skills/s1");
  });

  it("gets filtered tools with encoded session id", async () => {
    mockApiClient.get.mockResolvedValueOnce({ tools: [{ name: "read_file" }] });

    const tools = await skillService.getFilteredTools("session/a b");

    expect(mockApiClient.get).toHaveBeenCalledWith(
      "skills/filtered-tools?session_id=session%2Fa%20b",
    );
    expect(tools).toEqual([{ name: "read_file" }]);
  });

  it("returns empty list when tools field is missing", async () => {
    mockApiClient.get.mockResolvedValueOnce({});

    await expect(skillService.getFilteredTools()).resolves.toEqual([]);
    expect(mockApiClient.get).toHaveBeenCalledWith("skills/filtered-tools");
  });
});
