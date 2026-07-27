import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configSectionsService } from "@services/config/configSections";
import { useConfigSectionStore } from "@shared/store/configSectionStore";
import SystemSettingsConnectTab from "../SystemSettingsConnectTab";

const CONFIGURED_CONNECT = {
  platforms: [
    {
      id: "telegram-main",
      project_id: "project-telegram",
      type: "telegram",
      token_configured: true,
      token_credential_ref: "connect:telegram-main:token",
      token_credential: {
        credential_ref: "connect:telegram-main:token",
        configured: true,
        state: "configured" as const,
        source: "user",
        updated_at: null,
      },
      allow_from: ["u1"],
      admin_from: ["admin-telegram"],
    },
    {
      id: "feishu-main",
      project_id: "project-feishu",
      type: "feishu",
      app_id: "cli_abc123",
      app_secret_configured: true,
      app_secret_credential_ref: "connect:feishu-main:app_secret",
      app_secret_credential: {
        credential_ref: "connect:feishu-main:app_secret",
        configured: true,
        state: "from_env" as const,
        source: "environment",
        updated_at: null,
      },
      domain: "lark",
      allow_from: ["ou_1"],
      admin_from: ["admin-feishu"],
    },
  ],
};

const connectEnvelope = (data = CONFIGURED_CONNECT, revision = 7) => ({
  data,
  revision,
  loaded_at: "2026-07-23T00:00:00.000Z",
  source_path: "/tmp/connect.json",
  source_kind: "file" as const,
  status: "healthy" as const,
  last_error: null,
});

describe("SystemSettingsConnectTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfigSectionStore.getState().reset();
    vi.spyOn(configSectionsService, "getSection").mockResolvedValue(connectEnvelope() as never);
    vi.spyOn(configSectionsService, "putConnect").mockImplementation(async (_revision, data) =>
      connectEnvelope({ platforms: data.platforms } as never, 8),
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it("never prefills a masked secret into the token/app-secret inputs", async () => {
    render(<SystemSettingsConnectTab />);

    const tokenInput = (await screen.findByTestId("connect-telegram-token")) as HTMLInputElement;
    const secretInput = (await screen.findByTestId(
      "connect-feishu-app-secret",
    )) as HTMLInputElement;

    expect(tokenInput.value).toBe("");
    expect(secretInput.value).toBe("");
    // Non-secret fields still load from the server response.
    expect((await screen.findByTestId("connect-feishu-app-id")) as HTMLInputElement).toHaveValue(
      "cli_abc123",
    );
  });

  it("loads enable toggles from platform presence in the array", async () => {
    render(<SystemSettingsConnectTab />);

    const telegramSwitch = await screen.findByTestId("connect-telegram-enabled");
    const feishuSwitch = await screen.findByTestId("connect-feishu-enabled");

    expect(telegramSwitch).toHaveAttribute("aria-checked", "true");
    expect(feishuSwitch).toHaveAttribute("aria-checked", "true");
  });

  it("omits untouched secrets and preserves ids, projects, and admin allowlists", async () => {
    render(<SystemSettingsConnectTab />);
    await screen.findByTestId("connect-telegram-token");

    fireEvent.click(screen.getByTestId("connect-save-button"));

    await waitFor(() => expect(configSectionsService.putConnect).toHaveBeenCalledTimes(1));
    const [revision, patch] = vi.mocked(configSectionsService.putConnect).mock.calls[0];
    const telegram = patch.platforms.find((p: { type: string }) => p.type === "telegram");
    const feishu = patch.platforms.find((p: { type: string }) => p.type === "feishu");
    expect(revision).toBe(7);
    expect(telegram).toMatchObject({
      id: "telegram-main",
      project_id: "project-telegram",
      type: "telegram",
      admin_from: ["admin-telegram"],
    });
    expect(telegram).not.toHaveProperty("token");
    expect(telegram).not.toHaveProperty("token_change");
    expect(feishu).toMatchObject({
      id: "feishu-main",
      project_id: "project-feishu",
      type: "feishu",
      admin_from: ["admin-feishu"],
    });
    expect(feishu).not.toHaveProperty("app_secret");
    expect(feishu).not.toHaveProperty("app_secret_change");
  });

  it("sends the new plaintext value when a secret is edited", async () => {
    render(<SystemSettingsConnectTab />);
    const tokenInput = await screen.findByTestId("connect-telegram-token");

    fireEvent.change(tokenInput, { target: { value: "tg-new-secret" } });
    fireEvent.click(screen.getByTestId("connect-save-button"));

    await waitFor(() => expect(configSectionsService.putConnect).toHaveBeenCalledTimes(1));
    const [, patch] = vi.mocked(configSectionsService.putConnect).mock.calls[0];
    const telegram = patch.platforms.find((p: { type: string }) => p.type === "telegram");
    expect(telegram.token_change).toEqual({
      action: "replace",
      value: "tg-new-secret",
    });
  });

  it("drops a platform from the saved array when its toggle is switched off", async () => {
    render(<SystemSettingsConnectTab />);
    const telegramSwitch = await screen.findByTestId("connect-telegram-enabled");

    fireEvent.click(telegramSwitch);
    fireEvent.click(screen.getByTestId("connect-save-button"));

    await waitFor(() => expect(configSectionsService.putConnect).toHaveBeenCalledTimes(1));
    const [, patch] = vi.mocked(configSectionsService.putConnect).mock.calls[0];
    expect(patch.platforms.some((p: { type: string }) => p.type === "telegram")).toBe(false);
    expect(patch.platforms.some((p: { type: string }) => p.type === "feishu")).toBe(true);
  });

  it("omits a secret field for a newly enabled platform with no stored value", async () => {
    vi.mocked(configSectionsService.getSection).mockResolvedValue(
      connectEnvelope({ platforms: [] }) as never,
    );
    render(<SystemSettingsConnectTab />);
    const telegramSwitch = await screen.findByTestId("connect-telegram-enabled");

    fireEvent.click(telegramSwitch);
    fireEvent.click(screen.getByTestId("connect-save-button"));

    await waitFor(() => expect(configSectionsService.putConnect).toHaveBeenCalledTimes(1));
    const [, patch] = vi.mocked(configSectionsService.putConnect).mock.calls[0];
    const telegram = patch.platforms.find((p: { type: string }) => p.type === "telegram");
    expect(telegram).not.toHaveProperty("token");
    expect(telegram).not.toHaveProperty("token_change");
  });

  it("shows a deny-all warning when a platform is enabled with no allowed IDs", async () => {
    vi.mocked(configSectionsService.getSection).mockResolvedValue(
      connectEnvelope({ platforms: [] }) as never,
    );
    render(<SystemSettingsConnectTab />);
    const telegramSwitch = await screen.findByTestId("connect-telegram-enabled");

    fireEvent.click(telegramSwitch);

    expect(await screen.findByText(/every inbound message will be rejected/i)).toBeInTheDocument();
  });

  it("adopts a newer exact section snapshot while the form is clean", async () => {
    render(<SystemSettingsConnectTab />);
    const appId = (await screen.findByTestId("connect-feishu-app-id")) as HTMLInputElement;

    const remote = {
      platforms: CONFIGURED_CONNECT.platforms.map((platform) =>
        platform.type === "feishu" ? { ...platform, app_id: "cli_remote" } : platform,
      ),
    };
    act(() => {
      useConfigSectionStore.setState((state) => ({
        sections: {
          ...state.sections,
          connect: { ...state.sections.connect, envelope: connectEnvelope(remote, 8) },
        },
      }));
    });

    await waitFor(() => expect(appId).toHaveValue("cli_remote"));
    expect(screen.queryByText(/changed externally/i)).not.toBeInTheDocument();
  });

  it("preserves a dirty draft, compares without secrets, and saves against its captured revision", async () => {
    render(<SystemSettingsConnectTab />);
    const appId = (await screen.findByTestId("connect-feishu-app-id")) as HTMLInputElement;
    const token = screen.getByTestId("connect-telegram-token");
    fireEvent.change(appId, { target: { value: "cli_local" } });
    fireEvent.change(token, { target: { value: "do-not-display" } });

    const remote = {
      platforms: CONFIGURED_CONNECT.platforms.map((platform) =>
        platform.type === "feishu" ? { ...platform, app_id: "cli_remote" } : platform,
      ),
    };
    act(() => {
      useConfigSectionStore.setState((state) => ({
        sections: {
          ...state.sections,
          connect: { ...state.sections.connect, envelope: connectEnvelope(remote, 8) },
        },
      }));
    });

    expect(await screen.findByText(/changed externally/i)).toBeInTheDocument();
    expect(appId).toHaveValue("cli_local");
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    const comparison = screen.getByTestId("connect-revision-comparison");
    expect(comparison).toHaveTextContent("cli_local");
    expect(comparison).toHaveTextContent("cli_remote");
    expect(comparison).toHaveTextContent("[replace requested]");
    expect(comparison).not.toHaveTextContent("do-not-display");

    fireEvent.click(screen.getByTestId("connect-save-button"));
    await waitFor(() => expect(configSectionsService.putConnect).toHaveBeenCalled());
    expect(vi.mocked(configSectionsService.putConnect).mock.calls[0]?.[0]).toBe(7);
  });

  it("reapplies a dirty draft over the latest exact section and advances its base", async () => {
    render(<SystemSettingsConnectTab />);
    const appId = (await screen.findByTestId("connect-feishu-app-id")) as HTMLInputElement;
    fireEvent.change(appId, { target: { value: "cli_local" } });

    const remote = {
      platforms: CONFIGURED_CONNECT.platforms.map((platform) =>
        platform.type === "feishu" ? { ...platform, app_id: "cli_remote" } : platform,
      ),
    };
    act(() => {
      useConfigSectionStore.setState((state) => ({
        sections: {
          ...state.sections,
          connect: { ...state.sections.connect, envelope: connectEnvelope(remote, 8) },
        },
      }));
    });

    fireEvent.click(await screen.findByRole("button", { name: "Reapply" }));
    await waitFor(() => expect(appId).toHaveValue("cli_local"));
    fireEvent.click(screen.getByTestId("connect-save-button"));

    await waitFor(() => expect(configSectionsService.putConnect).toHaveBeenCalled());
    expect(vi.mocked(configSectionsService.putConnect).mock.calls[0]?.[0]).toBe(8);
  });
});
