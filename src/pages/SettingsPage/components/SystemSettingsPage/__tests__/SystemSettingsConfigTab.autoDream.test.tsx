import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App as AntdApp } from "antd";

import SystemSettingsConfigTab from "../SystemSettingsConfigTab";
import { serviceFactory } from "@services/common/ServiceFactory";
import { configSectionsService, type ConfigSectionId } from "@services/config/configSections";
import { useConfigSectionStore } from "@shared/store/configSectionStore";

vi.mock("@services/common/ServiceFactory", () => ({
  serviceFactory: {
    getBambooTools: vi.fn(),
    validateBambooConfigPatch: vi.fn(),
  },
}));

const mockGetBambooTools = vi.mocked(serviceFactory.getBambooTools);
const mockValidateBambooConfigPatch = vi.mocked(serviceFactory.validateBambooConfigPatch);

const sectionEnvelope = (section: ConfigSectionId, memoryData: unknown = {
  auto_dream_enabled: true,
  background_model: "gpt-4.1-mini",
}) => ({
  data:
    section === "core"
      ? { http_proxy: "", https_proxy: "" }
      : section === "memory"
        ? memoryData
        : section === "subagents"
          ? { max_concurrent: 8 }
          : section === "tools-skills"
            ? { tools: { disabled: [] } }
            : {},
  revision: section === "memory" ? 4 : 2,
  loaded_at: "2026-07-23T00:00:00.000Z",
  source_path: `/tmp/${section}.json`,
  source_kind: "file" as const,
  status: "healthy" as const,
  last_error: null,
});

describe("SystemSettingsConfigTab auto dream settings", () => {
  const msgApi = {
    success: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useConfigSectionStore.getState().reset();
    vi.spyOn(configSectionsService, "getSection").mockImplementation(
      async (section) => sectionEnvelope(section) as never,
    );
    vi.spyOn(configSectionsService, "putSection").mockImplementation(
      async (section, _revision, data) => ({
        ...sectionEnvelope(section),
        data,
        revision: 5,
      }) as never,
    );
    vi.spyOn(configSectionsService, "getProxyAuthStatus").mockResolvedValue({
      configured: false,
      credential_ref: null,
      source: null,
      updated_at: null,
      revision: 1,
      status: "healthy",
      source_kind: "file",
      last_error: null,
    });
    mockGetBambooTools.mockResolvedValue({ tools: [] });
    mockValidateBambooConfigPatch.mockResolvedValue({ valid: true, errors: {} });
  });

  afterEach(() => vi.restoreAllMocks());

  it("loads and saves auto dream settings", async () => {
    render(
      <AntdApp>
        <SystemSettingsConfigTab msgApi={msgApi} locale="en-US" onLocaleChange={() => undefined} />
      </AntdApp>,
    );

    const toggle = await screen.findByTestId("auto-dream-toggle");

    expect(toggle.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(toggle);
    fireEvent.click(screen.getByTestId("save-memory-settings"));

    await waitFor(() => {
      expect(mockValidateBambooConfigPatch).toHaveBeenCalledWith({
        memory: {
          auto_dream_enabled: false,
        },
      });
      expect(configSectionsService.putSection).toHaveBeenCalledWith(
        "memory",
        4,
        {
          background_model: "gpt-4.1-mini",
          auto_dream_enabled: false,
        },
      );
    });
  });

  it("falls back to disabled auto dream when memory config is missing", async () => {
    vi.mocked(configSectionsService.getSection).mockImplementation(
      async (section) => sectionEnvelope(section, null) as never,
    );

    render(
      <AntdApp>
        <SystemSettingsConfigTab msgApi={msgApi} locale="en-US" onLocaleChange={() => undefined} />
      </AntdApp>,
    );

    const toggle = await screen.findByTestId("auto-dream-toggle");

    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("does not save when validation fails", async () => {
    mockValidateBambooConfigPatch.mockResolvedValueOnce({
      valid: false,
      errors: {
        memory: [{ path: "memory.auto_dream_enabled", message: "Invalid auto dream setting" }],
      },
    });

    render(
      <AntdApp>
        <SystemSettingsConfigTab msgApi={msgApi} locale="en-US" onLocaleChange={() => undefined} />
      </AntdApp>,
    );

    await screen.findByTestId("auto-dream-toggle");
    fireEvent.click(screen.getByTestId("save-memory-settings"));

    await waitFor(() => {
      expect(msgApi.error).toHaveBeenCalled();
      expect(configSectionsService.putSection).not.toHaveBeenCalled();
    });
  });
});
