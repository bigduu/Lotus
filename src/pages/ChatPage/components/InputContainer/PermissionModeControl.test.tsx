import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { changeLocale } from "@shared/i18n";
import { PermissionModeControl } from "./PermissionModeControl";

const confirm = vi.fn();

vi.mock("antd", async () => {
  const actual = await vi.importActual<typeof import("antd")>("antd");
  return {
    ...actual,
    App: Object.assign(actual.App, {
      useApp: () => ({ modal: { confirm } }),
    }),
  };
});

describe("PermissionModeControl", () => {
  beforeEach(async () => {
    confirm.mockReset();
    await changeLocale("en-US");
  });

  afterEach(async () => {
    await changeLocale("en-US");
  });

  it("requires one conspicuous session-scoped confirmation before enabling Auto", async () => {
    const onChange = vi.fn();
    render(
      <PermissionModeControl
        mode="default"
        supportsAuto
        mutationStatus="idle"
        sessionTitle="Release work"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByTestId("permission-mode-control"));
    fireEvent.click(await screen.findByText("Auto"));

    expect(onChange).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledOnce();
    const config = confirm.mock.calls[0][0];
    expect(config.title).toBe("Enable dangerous Auto mode?");
    expect(config.okButtonProps).toEqual({ danger: true });
    render(config.content);
    expect(screen.getByText(/including high-risk operations/i)).toBeInTheDocument();
    expect(screen.getByText(/Release work/)).toBeInTheDocument();

    await config.onOk();
    expect(onChange).toHaveBeenCalledWith("auto");
  });

  it("disables Auto on an older backend instead of emulating it", async () => {
    const onChange = vi.fn();
    render(
      <PermissionModeControl
        mode="bypass"
        supportsAuto={false}
        mutationStatus="idle"
        sessionTitle="Legacy"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByTestId("permission-mode-control"));
    const autoItem = (await screen.findByText("Auto")).closest("li");
    expect(autoItem).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(autoItem!);
    expect(confirm).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/requires a newer Bamboo backend/i)).toBeInTheDocument();
  });

  it("keeps Auto text visible in the compact mobile layout and shows status", () => {
    render(
      <PermissionModeControl
        mode="auto"
        supportsAuto
        mutationStatus="success"
        sessionTitle="Mobile"
        compact
        onChange={vi.fn()}
      />,
    );

    const control = screen.getByTestId("permission-mode-control");
    expect(control).toHaveTextContent("Auto");
    expect(control).toHaveAttribute("data-permission-mode", "auto");
    expect(screen.getByTestId("permission-mode-status")).toHaveTextContent("Saved");
  });

  it("renders the mode and semantics in zh-CN", async () => {
    await changeLocale("zh-CN");
    render(
      <PermissionModeControl
        mode="bypass"
        supportsAuto
        mutationStatus="idle"
        sessionTitle="中文会话"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("permission-mode-control")).toHaveTextContent("免确认");
    fireEvent.click(screen.getByTestId("permission-mode-control"));
    await waitFor(() => {
      expect(screen.getByText(/强制高危操作和始终询问规则仍需批准/)).toBeInTheDocument();
    });
  });
});
