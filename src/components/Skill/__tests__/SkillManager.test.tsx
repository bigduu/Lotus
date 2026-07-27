import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SkillManager } from "../SkillManager";
import { skillService } from "@services/skill/SkillService";
import { configSectionsService } from "@services/config/configSections";
import { useConfigSectionStore } from "@shared/store/configSectionStore";

vi.mock("@services/skill/SkillService", () => ({
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
    vi.spyOn(configSectionsService, "putSection").mockImplementation(
      async (_section, _revision, data) =>
        ({
          data,
          revision: 7,
          loaded_at: "2026-07-23T00:00:01.000Z",
          source_path: "/tmp/tools-skills.json",
          source_kind: "file",
          status: "healthy",
          last_error: null,
        }) as never,
    );

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

  afterEach(() => vi.restoreAllMocks());

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
      expect(configSectionsService.putSection).toHaveBeenCalledWith(
        "tools-skills",
        6,
        expect.objectContaining({
          skills: {
            disabled: ["pdf", "pptx"],
          },
        }),
      );
    });
  }, 20000);
});
