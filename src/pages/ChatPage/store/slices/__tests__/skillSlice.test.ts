import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockListSkills, mockGetSkill } = vi.hoisted(() => ({
  mockListSkills: vi.fn(),
  mockGetSkill: vi.fn(),
}));

vi.mock("../../../services/SkillService", () => ({
  skillService: {
    listSkills: mockListSkills,
    getSkill: mockGetSkill,
  },
}));

import { createSkillSlice, type SkillSlice } from "../skillSlice";
import { createSliceHarness } from "./sliceHarness";

describe("skillSlice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads skills successfully", async () => {
    mockListSkills.mockResolvedValueOnce({
      skills: [{ id: "s1", name: "Skill 1" }],
      total: 1,
    });
    const harness = createSliceHarness<SkillSlice>(createSkillSlice as any);

    await harness.getState().loadSkills({ search: "skill" }, true);

    expect(mockListSkills).toHaveBeenCalledWith({ search: "skill" }, true);
    expect(harness.getState().skills).toEqual([{ id: "s1", name: "Skill 1" }]);
    expect(harness.getState().isLoadingSkills).toBe(false);
    expect(harness.getState().skillsError).toBeNull();
  });

  it("stores load error message", async () => {
    mockListSkills.mockRejectedValueOnce(new Error("load failed"));
    const harness = createSliceHarness<SkillSlice>(createSkillSlice as any);

    await harness.getState().loadSkills();

    expect(harness.getState().skillsError).toBe("load failed");
    expect(harness.getState().isLoadingSkills).toBe(false);
  });

  it("adds new skill and updates existing skill by id", async () => {
    const harness = createSliceHarness<SkillSlice>(createSkillSlice as any);

    mockGetSkill.mockResolvedValueOnce({ id: "s1", name: "Skill 1" });
    await harness.getState().getSkill("s1");
    expect(harness.getState().skills).toEqual([{ id: "s1", name: "Skill 1" }]);

    mockGetSkill.mockResolvedValueOnce({ id: "s1", name: "Skill 1 Updated" });
    await harness.getState().getSkill("s1");
    expect(harness.getState().skills).toEqual([{ id: "s1", name: "Skill 1 Updated" }]);
  });

  it("sets getSkill errors and supports clearSkillsError", async () => {
    mockGetSkill.mockRejectedValueOnce(new Error("missing skill"));
    const harness = createSliceHarness<SkillSlice>(createSkillSlice as any);

    await harness.getState().getSkill("missing");
    expect(harness.getState().skillsError).toBe("missing skill");

    harness.getState().clearSkillsError();
    expect(harness.getState().skillsError).toBeNull();
  });
});
