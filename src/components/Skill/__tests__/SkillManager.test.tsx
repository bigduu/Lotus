import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SkillManager } from "../SkillManager";
import { skillService } from "../../../services/skill/SkillService";
import { useBambooConfigStore } from "../../../shared/stores/bambooConfigStore";

vi.mock("../../../services/skill/SkillService", () => ({
  skillService: {
    listSkills: vi.fn(),
  },
}));

vi.mock("antd", async () => {
  const actual = await vi.importActual<typeof import("antd")>("antd");
  const message = {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
  };
  const notification = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  };
  const modal = {
    confirm: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  };
  return {
    ...actual,
    message,
    notification,
    App: Object.assign(actual.App, {
      useApp: () => ({ message, notification, modal }),
    }),
  };
});

describe("SkillManager", () => {
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
      saveConfig: vi.fn().mockResolvedValue({ skills: { disabled: ["pdf", "pptx"] } }),
      patchConfig: vi.fn(),
      loadProxyAuthStatus: vi.fn(),
      applyProxyAuth: vi.fn(),
      clearProxyAuth: vi.fn(),
    });

    vi.mocked(skillService.listSkills).mockResolvedValue({
      total: 2,
      skills: [
        {
          id: "pdf",
          name: "PDF",
          description: "PDF helper",
          prompt: "prompt",
          tool_refs: ["Read"],
        },
        {
          id: "pptx",
          name: "PPTX",
          description: "Slides helper",
          prompt: "prompt",
          tool_refs: ["Read"],
        },
      ],
    });
  });

  it("loads full skills with includeDisabled and shows disabled markers", async () => {
    render(<SkillManager />);

    await waitFor(() => {
      expect(skillService.listSkills).toHaveBeenCalledWith({ includeDisabled: true }, true);
    });

    expect(await screen.findByText("PDF")).toBeInTheDocument();
    expect(screen.getByText("PPTX")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
  });

  it("saves the full disabled array when toggling a skill off", async () => {
    render(<SkillManager />);

    await screen.findByText("PPTX");

    const switches = screen.getAllByRole("switch");
    fireEvent.click(switches[1]);

    await waitFor(() => {
      expect(useBambooConfigStore.getState().saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          skills: {
            disabled: ["pdf", "pptx"],
          },
        }),
      );
    });
  });
});
