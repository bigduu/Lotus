import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SystemSettingsConnectTab from "../SystemSettingsConnectTab";

const { mockGetBambooConfig, mockSetBambooConfig } = vi.hoisted(() => ({
  mockGetBambooConfig: vi.fn(),
  mockSetBambooConfig: vi.fn(),
}));

vi.mock("@services/common/ServiceFactory", () => ({
  serviceFactory: {
    getBambooConfig: mockGetBambooConfig,
    setBambooConfig: mockSetBambooConfig,
  },
}));

const CONFIGURED_CONNECT = {
  platforms: [
    { type: "telegram", token: "****...****", allow_from: ["u1"] },
    {
      type: "feishu",
      app_id: "cli_abc123",
      app_secret: "****...****",
      domain: "lark",
      allow_from: ["ou_1"],
    },
  ],
};

describe("SystemSettingsConnectTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBambooConfig.mockResolvedValue({ connect: CONFIGURED_CONNECT });
    mockSetBambooConfig.mockResolvedValue({ connect: CONFIGURED_CONNECT });
  });

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

  it("re-sends the mask placeholder (not omits it) for an untouched configured secret", async () => {
    render(<SystemSettingsConnectTab />);
    await screen.findByTestId("connect-telegram-token");

    fireEvent.click(screen.getByTestId("connect-save-button"));

    await waitFor(() => expect(mockSetBambooConfig).toHaveBeenCalledTimes(1));
    const patch = mockSetBambooConfig.mock.calls[0][0];
    const telegram = patch.connect.platforms.find((p: { type: string }) => p.type === "telegram");
    const feishu = patch.connect.platforms.find((p: { type: string }) => p.type === "feishu");
    expect(telegram.token).toBe("****...****");
    expect(feishu.app_secret).toBe("****...****");
  });

  it("sends the new plaintext value when a secret is edited", async () => {
    render(<SystemSettingsConnectTab />);
    const tokenInput = await screen.findByTestId("connect-telegram-token");

    fireEvent.change(tokenInput, { target: { value: "tg-new-secret" } });
    fireEvent.click(screen.getByTestId("connect-save-button"));

    await waitFor(() => expect(mockSetBambooConfig).toHaveBeenCalledTimes(1));
    const patch = mockSetBambooConfig.mock.calls[0][0];
    const telegram = patch.connect.platforms.find((p: { type: string }) => p.type === "telegram");
    expect(telegram.token).toBe("tg-new-secret");
  });

  it("drops a platform from the saved array when its toggle is switched off", async () => {
    render(<SystemSettingsConnectTab />);
    const telegramSwitch = await screen.findByTestId("connect-telegram-enabled");

    fireEvent.click(telegramSwitch);
    fireEvent.click(screen.getByTestId("connect-save-button"));

    await waitFor(() => expect(mockSetBambooConfig).toHaveBeenCalledTimes(1));
    const patch = mockSetBambooConfig.mock.calls[0][0];
    expect(patch.connect.platforms.some((p: { type: string }) => p.type === "telegram")).toBe(
      false,
    );
    expect(patch.connect.platforms.some((p: { type: string }) => p.type === "feishu")).toBe(true);
  });

  it("omits a secret field for a newly enabled platform with no stored value", async () => {
    mockGetBambooConfig.mockResolvedValue({ connect: { platforms: [] } });
    render(<SystemSettingsConnectTab />);
    const telegramSwitch = await screen.findByTestId("connect-telegram-enabled");

    fireEvent.click(telegramSwitch);
    fireEvent.click(screen.getByTestId("connect-save-button"));

    await waitFor(() => expect(mockSetBambooConfig).toHaveBeenCalledTimes(1));
    const patch = mockSetBambooConfig.mock.calls[0][0];
    const telegram = patch.connect.platforms.find((p: { type: string }) => p.type === "telegram");
    expect(telegram).not.toHaveProperty("token");
  });

  it("shows a deny-all warning when a platform is enabled with no allowed IDs", async () => {
    mockGetBambooConfig.mockResolvedValue({ connect: { platforms: [] } });
    render(<SystemSettingsConnectTab />);
    const telegramSwitch = await screen.findByTestId("connect-telegram-enabled");

    fireEvent.click(telegramSwitch);

    expect(await screen.findByText(/every inbound message will be rejected/i)).toBeInTheDocument();
  });
});
