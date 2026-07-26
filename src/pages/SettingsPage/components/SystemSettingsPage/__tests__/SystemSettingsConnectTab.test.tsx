import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configSectionsService } from "@services/config/configSections";
import { useConfigSectionStore } from "@shared/store/configSectionStore";
import SystemSettingsConnectTab from "../SystemSettingsConnectTab";

const CONFIGURED_CONNECT = {
  platforms: [
    {
      id: "telegram-main",
      type: "telegram",
      token_configured: true,
      token_credential_ref: "connect:telegram-main:token",
      allow_from: ["u1"],
    },
    {
      id: "feishu-main",
      type: "feishu",
      app_id: "cli_abc123",
      app_secret_configured: true,
      app_secret_credential_ref: "connect:feishu-main:app_secret",
      domain: "lark",
      allow_from: ["ou_1"],
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

const credentialsEnvelope = (revision = 31) => ({
  data: [],
  revision,
  status: "healthy" as const,
  source: "credentials.json",
  last_error: null,
});

describe("SystemSettingsConnectTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfigSectionStore.getState().reset();
    vi.spyOn(configSectionsService, "getSection").mockResolvedValue(connectEnvelope() as never);
    vi.spyOn(configSectionsService, "listCredentials").mockResolvedValue(credentialsEnvelope());
    vi.spyOn(configSectionsService, "putConnect").mockImplementation(async (_revision, data) => ({
      envelope: connectEnvelope({ platforms: data.platforms } as never, 8),
      credentialRevision: 32,
    }));
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

  it("omits untouched configured secrets and preserves stable platform ids", async () => {
    render(<SystemSettingsConnectTab />);
    await screen.findByTestId("connect-telegram-token");

    fireEvent.click(screen.getByTestId("connect-save-button"));

    await waitFor(() => expect(configSectionsService.putConnect).toHaveBeenCalledTimes(1));
    const [revision, patch] = vi.mocked(configSectionsService.putConnect).mock.calls[0];
    const telegram = patch.platforms.find((p: { type: string }) => p.type === "telegram");
    const feishu = patch.platforms.find((p: { type: string }) => p.type === "feishu");
    expect(revision).toBe(31);
    expect(telegram).toMatchObject({ id: "telegram-main", type: "telegram" });
    expect(telegram).not.toHaveProperty("token");
    expect(feishu).toMatchObject({ id: "feishu-main", type: "feishu" });
    expect(feishu).not.toHaveProperty("app_secret");
  });

  it("sends the new plaintext value when a secret is edited", async () => {
    render(<SystemSettingsConnectTab />);
    const tokenInput = await screen.findByTestId("connect-telegram-token");

    fireEvent.change(tokenInput, { target: { value: "tg-new-secret" } });
    fireEvent.click(screen.getByTestId("connect-save-button"));

    await waitFor(() => expect(configSectionsService.putConnect).toHaveBeenCalledTimes(1));
    const [, patch] = vi.mocked(configSectionsService.putConnect).mock.calls[0];
    const telegram = patch.platforms.find((p: { type: string }) => p.type === "telegram");
    expect(telegram.token).toBe("tg-new-secret");
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
});
