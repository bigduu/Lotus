import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SkillSelector } from "../SkillSelector";
import { configSectionsService } from "@services/config/configSections";
import { useConfigSectionStore } from "@shared/store/configSectionStore";

const mockLoadSkills = vi.fn();
const mockStoreState = {
  skills: [
    {
      id: "pdf",
      name: "PDF",
      description: "PDF helper",
      prompt: "",
      tool_refs: ["Read"],
    },
    {
      id: "pptx",
      name: "PPTX",
      description: "Slides helper",
      prompt: "",
      tool_refs: ["Read"],
    },
  ],
  isLoadingSkills: false,
  loadSkills: mockLoadSkills,
};

vi.mock("@shared/store/appStore", () => {
  const useAppStore = (selector: (state: typeof mockStoreState) => unknown) =>
    selector(mockStoreState);
  return { useAppStore };
});

describe("SkillSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfigSectionStore.getState().reset();
    vi.spyOn(configSectionsService, "getSection").mockResolvedValue({
      data: { skills: { disabled: ["pdf"] } },
      revision: 6,
      loaded_at: "2026-07-23T00:00:00.000Z",
      source_path: "/tmp/tools-skills.json",
      source_kind: "file",
      status: "healthy",
      last_error: null,
    } as never);
  });

  afterEach(() => vi.restoreAllMocks());

  it("filters disabled skills from visible selection and notifies caller", async () => {
    const onChange = vi.fn();

    render(<SkillSelector selectedSkillIds={["pdf", "pptx"]} onChange={onChange} />);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(["pptx"]);
    });

    expect(
      screen.getByText(
        "1 previously selected skill is now globally disabled and has been removed.",
      ),
    ).toBeInTheDocument();
  });
});
