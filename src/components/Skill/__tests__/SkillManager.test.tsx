import React from "react";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
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

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const skillResponse = (id: string, name: string) => ({
  total: 1,
  skills: [
    {
      id,
      name,
      description: `${name} helper`,
      prompt: "prompt",
      tool_refs: ["Read"],
    },
  ],
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

  it("keeps the Skill catalog visible and disables mutations when typed config fails", async () => {
    vi.mocked(configSectionsService.getSection).mockRejectedValue(
      new Error("typed sections require the modular configuration facade"),
    );

    render(<SkillManager />);

    expect(await screen.findByText("PDF")).toBeInTheDocument();
    expect(screen.getByText("PPTX")).toBeInTheDocument();
    expect(screen.queryByText("No skills found")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Skill enable/disable settings are unavailable. The catalog remains visible in read-only mode.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("typed sections require the modular configuration facade"),
    ).toBeInTheDocument();

    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(configSectionsService.putSection).not.toHaveBeenCalled();
  });

  it("renders the Skill catalog without waiting for typed config to settle", async () => {
    let resolveConfig: ((value: unknown) => void) | undefined;
    vi.mocked(configSectionsService.getSection).mockReturnValue(
      new Promise((resolve) => {
        resolveConfig = resolve;
      }) as never,
    );

    render(<SkillManager />);

    expect(await screen.findByText("PDF")).toBeInTheDocument();
    expect(screen.getByText("PPTX")).toBeInTheDocument();
    expect(screen.queryAllByRole("switch")).toHaveLength(0);

    await act(async () => {
      resolveConfig?.({
        data: { skills: { disabled: ["pdf"] } },
        revision: 6,
        loaded_at: "2026-07-23T00:00:00.000Z",
        source_path: "/tmp/tools-skills.json",
        source_kind: "file",
        status: "healthy",
        last_error: null,
      });
    });

    await waitFor(() =>
      screen.getAllByRole("switch").forEach((control) => expect(control).toBeEnabled()),
    );
  });

  it("handles an immediate config rejection while the independent catalog is still pending", async () => {
    const slowCatalog = deferred<Awaited<ReturnType<typeof skillService.listSkills>>>();
    vi.mocked(skillService.listSkills).mockReturnValueOnce(slowCatalog.promise);
    vi.mocked(configSectionsService.getSection).mockRejectedValueOnce(
      new Error("typed config rejected immediately"),
    );

    render(<SkillManager />);
    await waitFor(() => expect(configSectionsService.getSection).toHaveBeenCalledTimes(1));
    expect(screen.queryAllByRole("switch")).toHaveLength(0);

    await act(async () => {
      slowCatalog.resolve(skillResponse("slow", "Slow Skill"));
      await slowCatalog.promise;
    });

    expect(await screen.findByText("Slow Skill")).toBeInTheDocument();
    expect(screen.getByText("typed config rejected immediately")).toBeInTheDocument();
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
  });

  it("keeps a stale last-known-good snapshot read-only when its forced reload fails", async () => {
    await useConfigSectionStore.getState().loadSection("tools-skills", { force: true });
    vi.mocked(configSectionsService.getSection).mockRejectedValue(
      new Error("typed config reload failed"),
    );

    render(<SkillManager />);

    expect(await screen.findByText("PDF")).toBeInTheDocument();
    expect(useConfigSectionStore.getState().sections["tools-skills"].envelope?.revision).toBe(6);
    expect(useConfigSectionStore.getState().sections["tools-skills"].error).toBe(
      "typed config reload failed",
    );
    const switches = screen.getAllByRole("switch");
    switches.forEach((control) => expect(control).toBeDisabled());
    expect(switches[0]).not.toBeChecked();
    expect(switches[1]).toBeChecked();
    fireEvent.click(switches[1]);
    expect(configSectionsService.putSection).not.toHaveBeenCalled();
  });

  it("rechecks forced config health and refuses to save a degraded toggle snapshot", async () => {
    render(<SkillManager />);
    await waitFor(() =>
      screen.getAllByRole("switch").forEach((control) => expect(control).toBeEnabled()),
    );

    vi.mocked(configSectionsService.getSection).mockResolvedValueOnce({
      data: { skills: { disabled: ["pdf"] } },
      revision: 7,
      loaded_at: "2026-07-23T00:00:01.000Z",
      source_path: "/tmp/tools-skills.json",
      source_kind: "backup",
      status: "degraded",
      last_error: "latest tools-skills snapshot is degraded",
    } as never);

    fireEvent.click(screen.getAllByRole("switch")[1]);

    expect(await screen.findByText("latest tools-skills snapshot is degraded")).toBeInTheDocument();
    expect(configSectionsService.putSection).not.toHaveBeenCalled();
    screen.getAllByRole("switch").forEach((control) => expect(control).toBeDisabled());
  });

  it("ignores an older catalog success without clearing the newer refresh loading state", async () => {
    const staleCatalog = deferred<Awaited<ReturnType<typeof skillService.listSkills>>>();
    const currentCatalog = deferred<Awaited<ReturnType<typeof skillService.listSkills>>>();
    vi.mocked(skillService.listSkills)
      .mockReturnValueOnce(staleCatalog.promise)
      .mockReturnValueOnce(currentCatalog.promise);

    render(<SkillManager />);
    await waitFor(() => expect(skillService.listSkills).toHaveBeenCalledTimes(1));

    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(skillService.listSkills).toHaveBeenCalledTimes(2));

    await act(async () => {
      staleCatalog.resolve(skillResponse("stale", "Stale Skill"));
      await staleCatalog.promise;
    });

    expect(screen.queryByText("Stale Skill")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Refresh$/ })).toHaveClass("ant-btn-loading");

    await act(async () => {
      currentCatalog.resolve(skillResponse("current", "Current Skill"));
      await currentCatalog.promise;
    });

    expect(await screen.findByText("Current Skill")).toBeInTheDocument();
    expect(screen.queryByText("Stale Skill")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Refresh$/ })).not.toHaveClass("ant-btn-loading");
  });

  it("ignores an older catalog failure after a newer refresh succeeds", async () => {
    const staleCatalog = deferred<Awaited<ReturnType<typeof skillService.listSkills>>>();
    vi.mocked(skillService.listSkills)
      .mockReturnValueOnce(staleCatalog.promise)
      .mockResolvedValueOnce(skillResponse("current", "Current Skill"));

    render(<SkillManager />);
    await waitFor(() => expect(skillService.listSkills).toHaveBeenCalledTimes(1));

    act(() => window.dispatchEvent(new Event("focus")));
    expect(await screen.findByText("Current Skill")).toBeInTheDocument();

    await act(async () => {
      staleCatalog.reject(new Error("stale catalog failed"));
      await staleCatalog.promise.catch(() => undefined);
    });

    expect(screen.getByText("Current Skill")).toBeInTheDocument();
    expect(screen.queryByText("stale catalog failed")).not.toBeInTheDocument();
    expect(screen.queryByText("Failed to load skills")).not.toBeInTheDocument();
  });

  it("does not let an older config success clear the current refresh error", async () => {
    const staleConfig = deferred<unknown>();
    vi.spyOn(useConfigSectionStore.getState(), "loadSection")
      .mockReturnValueOnce(staleConfig.promise as never)
      .mockRejectedValueOnce(new Error("current config failed"));

    render(<SkillManager />);
    expect(await screen.findByText("PDF")).toBeInTheDocument();

    act(() => window.dispatchEvent(new Event("focus")));
    expect(await screen.findByText("current config failed")).toBeInTheDocument();

    await act(async () => {
      staleConfig.resolve({
        data: { skills: { disabled: [] } },
        revision: 5,
        loaded_at: "2026-07-23T00:00:00.000Z",
        source_path: "/tmp/tools-skills.json",
        source_kind: "file",
        status: "healthy",
        last_error: null,
      });
      await staleConfig.promise;
    });

    expect(screen.getByText("current config failed")).toBeInTheDocument();
  });
});
