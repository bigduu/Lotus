import { App as AntdApp } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SystemSettingsHooksTab from "../SystemSettingsHooksTab";
import { serviceFactory, type BambooConfig } from "@services/common/ServiceFactory";

vi.mock("@services/common/ServiceFactory", () => ({
  serviceFactory: {
    getBambooConfig: vi.fn(),
    setBambooConfig: vi.fn(),
    validateBambooConfigPatch: vi.fn(),
    testLifecycleHook: vi.fn(),
  },
}));

const mockGetConfig = vi.mocked(serviceFactory.getBambooConfig);
const mockSetConfig = vi.mocked(serviceFactory.setBambooConfig);
const mockValidate = vi.mocked(serviceFactory.validateBambooConfigPatch);
const mockTestHook = vi.mocked(serviceFactory.testLifecycleHook);

const configuredHook = (matcher = "^Bash$"): BambooConfig => ({
  hooks: { image_fallback: { enabled: false, mode: "placeholder" } },
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

const renderTab = () =>
  render(
    <AntdApp>
      <SystemSettingsHooksTab />
    </AntdApp>,
  );

describe("SystemSettingsHooksTab lifecycle hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockResolvedValue(configuredHook());
    mockValidate.mockResolvedValue({ valid: true, errors: {} });
    mockSetConfig.mockResolvedValue(configuredHook());
    mockTestHook.mockResolvedValue({
      exit_code: 0,
      stdout: "policy ok",
      stderr: "diagnostic",
      timed_out: false,
      stdout_truncated: false,
      stderr_truncated: false,
    });
  });

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
    await waitFor(() => expect(mockSetConfig).toHaveBeenCalledWith(patch));
  });

  it("maps server validation paths back to the matching inline field", async () => {
    mockGetConfig.mockResolvedValueOnce(configuredHook("^(a)\\1$"));
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
    expect(mockSetConfig).not.toHaveBeenCalled();
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
    mockGetConfig.mockResolvedValueOnce(configuredHook("(?P<tool>Bash)"));
    renderTab();

    await screen.findByDisplayValue("(?P<tool>Bash)");
    fireEvent.click(screen.getByRole("button", { name: "Save lifecycle hooks" }));

    await waitFor(() => expect(mockValidate).toHaveBeenCalledTimes(1));
    expect(mockSetConfig).toHaveBeenCalledTimes(1);
  });
});
