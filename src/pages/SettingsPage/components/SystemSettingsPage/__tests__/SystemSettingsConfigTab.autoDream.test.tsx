import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App as AntdApp } from "antd";

import SystemSettingsConfigTab from "../SystemSettingsConfigTab";
import { serviceFactory } from "../../../../../services/common/ServiceFactory";

vi.mock("../../../../../services/common/ServiceFactory", () => ({
  serviceFactory: {
    getBambooConfig: vi.fn(),
    getBambooTools: vi.fn(),
    validateBambooConfigPatch: vi.fn(),
    setBambooConfig: vi.fn(),
    getProxyAuthStatus: vi.fn(),
    setProxyAuth: vi.fn(),
    clearProxyAuth: vi.fn(),
  },
}));

const mockGetBambooConfig = vi.mocked(serviceFactory.getBambooConfig);
const mockGetBambooTools = vi.mocked(serviceFactory.getBambooTools);
const mockValidateBambooConfigPatch = vi.mocked(serviceFactory.validateBambooConfigPatch);
const mockSetBambooConfig = vi.mocked(serviceFactory.setBambooConfig);
const mockGetProxyAuthStatus = vi.mocked(serviceFactory.getProxyAuthStatus);

describe("SystemSettingsConfigTab auto dream settings", () => {
  const msgApi = {
    success: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBambooConfig.mockResolvedValue({
      http_proxy: "",
      https_proxy: "",
      memory: {
        auto_dream_enabled: true,
        background_model: "gpt-4.1-mini",
      },
    });
    mockGetBambooTools.mockResolvedValue({ tools: [] });
    mockGetProxyAuthStatus.mockResolvedValue({ configured: false, username: null });
    mockValidateBambooConfigPatch.mockResolvedValue({ valid: true, errors: {} });
    mockSetBambooConfig.mockResolvedValue({});
  });

  it("loads and saves auto dream settings", async () => {
    render(
      <AntdApp>
        <SystemSettingsConfigTab msgApi={msgApi} locale="en-US" onLocaleChange={() => undefined} />
      </AntdApp>,
    );

    const input = await screen.findByTestId("auto-dream-background-model-input");
    const toggle = screen.getByTestId("auto-dream-toggle");

    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(input).toHaveValue("gpt-4.1-mini");

    fireEvent.click(toggle);
    fireEvent.change(input, { target: { value: "gemini-2.5-flash" } });
    fireEvent.click(screen.getByTestId("save-memory-settings"));

    await waitFor(() => {
      expect(mockValidateBambooConfigPatch).toHaveBeenCalledWith({
        http_proxy: "",
        https_proxy: "",
        memory: {
          auto_dream_enabled: false,
          background_model: "gemini-2.5-flash",
        },
      });
      expect(mockSetBambooConfig).toHaveBeenCalledWith({
        http_proxy: "",
        https_proxy: "",
        memory: {
          auto_dream_enabled: false,
          background_model: "gemini-2.5-flash",
        },
      });
    });
  });

  it("falls back to disabled and empty background model when memory config is missing", async () => {
    mockGetBambooConfig.mockResolvedValueOnce({
      http_proxy: "",
      https_proxy: "",
    });

    render(
      <AntdApp>
        <SystemSettingsConfigTab msgApi={msgApi} locale="en-US" onLocaleChange={() => undefined} />
      </AntdApp>,
    );

    const input = await screen.findByTestId("auto-dream-background-model-input");
    const toggle = screen.getByTestId("auto-dream-toggle");

    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(input).toHaveValue("");
  });

  it("does not save when validation fails", async () => {
    mockValidateBambooConfigPatch.mockResolvedValueOnce({
      valid: false,
      errors: {
        memory: [{ path: "memory.background_model", message: "Invalid background model" }],
      },
    });

    render(
      <AntdApp>
        <SystemSettingsConfigTab msgApi={msgApi} locale="en-US" onLocaleChange={() => undefined} />
      </AntdApp>,
    );

    await screen.findByTestId("auto-dream-background-model-input");
    fireEvent.click(screen.getByTestId("save-memory-settings"));

    await waitFor(() => {
      expect(msgApi.error).toHaveBeenCalled();
      expect(mockSetBambooConfig).not.toHaveBeenCalled();
    });
  });
});
