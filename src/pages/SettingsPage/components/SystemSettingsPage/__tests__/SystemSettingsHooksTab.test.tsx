import { App as AntdApp } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SystemSettingsHooksTab from "../SystemSettingsHooksTab";
import { serviceFactory } from "@services/common/ServiceFactory";
import { configSectionsService, type HooksSection } from "@services/config/configSections";
import { useConfigSectionStore } from "@shared/store/configSectionStore";

vi.mock("@services/common/ServiceFactory", () => ({
  serviceFactory: {
    getBambooConfig: vi.fn(),
    validateBambooConfigPatch: vi.fn(),
    testLifecycleHook: vi.fn(),
  },
}));

const mockValidate = vi.mocked(serviceFactory.validateBambooConfigPatch);
const mockTestHook = vi.mocked(serviceFactory.testLifecycleHook);

const configuredHook = (matcher = "^Bash$"): HooksSection => ({
  image_fallback: { enabled: false, mode: "placeholder" },
  lifecycle_hooks: {
    enabled: true,
    PreToolUse: [
      {
        enabled: false,
        matcher,
        hooks: [{ type: "command", command: "echo policy", timeout_ms: 2_500 }],
      },
    ],
  },
});

const hooksEnvelope = (data = configuredHook(), revision = 12) => ({
  data,
  revision,
  loaded_at: "2026-07-23T00:00:00.000Z",
  source_path: "/tmp/hooks.json",
  source_kind: "file" as const,
  status: "healthy" as const,
  last_error: null,
});

const renderTab = () =>
  render(
    <AntdApp>
      <SystemSettingsHooksTab />
    </AntdApp>,
  );

describe("SystemSettingsHooksTab lifecycle hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfigSectionStore.getState().reset();
    vi.spyOn(configSectionsService, "getSection").mockResolvedValue(hooksEnvelope() as never);
    vi.spyOn(configSectionsService, "putSection").mockImplementation(
      async (_section, _revision, data) => hooksEnvelope(data as HooksSection, 13) as never,
    );
    mockValidate.mockResolvedValue({ valid: true, errors: {} });
    mockTestHook.mockResolvedValue({
      exit_code: 0,
      stdout: "policy ok",
      stderr: "diagnostic",
      timed_out: false,
      stdout_truncated: false,
      stderr_truncated: false,
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("loads, edits, validates, and saves a lifecycle-only config patch", async () => {
    renderTab();

    const command = (await screen.findByLabelText("Command")) as HTMLTextAreaElement;
    expect(command.value).toBe("echo policy");
    expect(screen.getByLabelText("Entry enabled")).toHaveAttribute("aria-checked", "false");

    fireEvent.change(command, { target: { value: "echo updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Save lifecycle hooks" }));

    await waitFor(() => expect(mockValidate).toHaveBeenCalledTimes(1));
    const patch = mockValidate.mock.calls[0][0];
    expect(patch.lifecycle_hooks?.enabled).toBe(true);
    expect(patch.lifecycle_hooks?.PreToolUse?.[0]).toEqual({
      enabled: false,
      matcher: "^Bash$",
      hooks: [{ type: "command", command: "echo updated", timeout_ms: 2_500 }],
    });
    expect(patch.lifecycle_hooks?.SessionEnd).toEqual([]);
    await waitFor(() =>
      expect(configSectionsService.putSection).toHaveBeenCalledWith(
        "hooks",
        12,
        expect.objectContaining({ lifecycle_hooks: patch.lifecycle_hooks }),
      ),
    );
  });

  it("maps server validation paths back to the matching inline field", async () => {
    vi.mocked(configSectionsService.getSection).mockResolvedValueOnce(
      hooksEnvelope(configuredHook("^(a)\\1$")) as never,
    );
    mockValidate.mockResolvedValueOnce({
      valid: false,
      errors: {
        lifecycle_hooks: [
          {
            path: "lifecycle_hooks.PreToolUse[0].matcher",
            message: "Rust regex rejected this matcher",
          },
        ],
      },
    });
    renderTab();

    await screen.findByDisplayValue("^(a)\\1$");
    fireEvent.click(screen.getByRole("button", { name: "Save lifecycle hooks" }));

    expect(await screen.findByText("Rust regex rejected this matcher")).toBeInTheDocument();
    expect(configSectionsService.putSection).not.toHaveBeenCalled();
  });

  it("runs the selected entry and renders exit code plus captured output", async () => {
    renderTab();

    await screen.findByDisplayValue("echo policy");
    fireEvent.click(screen.getByRole("button", { name: "Test hook" }));

    await waitFor(() => {
      expect(mockTestHook).toHaveBeenCalledWith({
        event: "PreToolUse",
        matcher: "^Bash$",
        command: "echo policy",
        timeout_ms: 2_500,
      });
    });
    expect(await screen.findByText("Hook test exited with code 0")).toBeInTheDocument();
    expect(screen.getByText("policy ok")).toBeInTheDocument();
    expect(screen.getByText("diagnostic")).toBeInTheDocument();
  });

  it("lets the Rust backend validate matcher syntax instead of rejecting Rust-only regexes", async () => {
    vi.mocked(configSectionsService.getSection).mockResolvedValueOnce(
      hooksEnvelope(configuredHook("(?P<tool>Bash)")) as never,
    );
    renderTab();

    await screen.findByDisplayValue("(?P<tool>Bash)");
    fireEvent.click(screen.getByRole("button", { name: "Save lifecycle hooks" }));

    await waitFor(() => expect(mockValidate).toHaveBeenCalledTimes(1));
    expect(configSectionsService.putSection).toHaveBeenCalledTimes(1);
  });

  it("keeps a dirty hook and reapplies it over an external addition", async () => {
    renderTab();

    const command = (await screen.findByLabelText("Command")) as HTMLTextAreaElement;
    fireEvent.change(command, { target: { value: "echo local" } });

    const state = useConfigSectionStore.getState();
    useConfigSectionStore.setState({
      sections: {
        ...state.sections,
        hooks: {
          ...state.sections.hooks,
          envelope: hooksEnvelope(
            {
              ...configuredHook(),
              lifecycle_hooks: {
                ...configuredHook().lifecycle_hooks,
                SessionEnd: [
                  {
                    enabled: true,
                    hooks: [{ type: "command", command: "echo remote", timeout_ms: 1_000 }],
                  },
                ],
              },
            },
            13,
          ),
        },
      },
    });

    expect(await screen.findByText(/Hooks configuration changed on disk/)).toBeInTheDocument();
    expect(command).toHaveValue("echo local");
    fireEvent.click(screen.getByRole("button", { name: "Reapply" }));
    fireEvent.click(screen.getByRole("button", { name: "Save lifecycle hooks" }));

    await waitFor(() => {
      const patch = mockValidate.mock.calls.at(-1)?.[0].lifecycle_hooks;
      expect(patch?.PreToolUse?.[0]?.hooks[0].command).toBe("echo local");
      expect(patch?.SessionEnd?.[0]?.hooks[0].command).toBe("echo remote");
      expect(configSectionsService.putSection).toHaveBeenCalledWith(
        "hooks",
        13,
        expect.objectContaining({ lifecycle_hooks: patch }),
      );
    });
  });
});
