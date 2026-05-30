import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SkillSelector } from "../SkillSelector";
import { useBambooConfigStore } from "../../../shared/store/bambooConfigStore";

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

vi.mock("../../../pages/ChatPage/store", () => {
  const useAppStore = (selector: (state: typeof mockStoreState) => unknown) =>
    selector(mockStoreState);
  return { useAppStore };
});

describe("SkillSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBambooConfigStore.setState({
      config: { skills: { disabled: ["pdf"] } } as any,
      proxyAuthStatus: null,
      isLoadingConfig: false,
      isLoadingProxyAuthStatus: false,
      lastLoadedAt: null,
      error: null,
      loadConfig: vi.fn().mockResolvedValue({ skills: { disabled: ["pdf"] } }),
      saveConfig: vi.fn(),
      patchConfig: vi.fn(),
      loadProxyAuthStatus: vi.fn(),
      applyProxyAuth: vi.fn(),
      clearProxyAuth: vi.fn(),
    });
  });

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
