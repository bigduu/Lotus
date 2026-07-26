import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configSectionsService } from "@services/config/configSections";
import { useConfigSectionStore } from "@shared/store/configSectionStore";
import NotificationChannelsSection from "../NotificationChannelsSection";

const { mockAgentPost } = vi.hoisted(() => ({
  mockAgentPost: vi.fn(),
}));

vi.mock("@services/api", async () => {
  const actual = await vi.importActual<typeof import("@services/api")>("@services/api");
  return {
    ...actual,
    agentApiClient: { post: mockAgentPost },
  };
});

const CONFIGURED_NOTIFICATIONS = {
  desktop: { enabled: null },
  ntfy: {
    enabled: true,
    base_url: "https://ntfy.sh",
    topic: "my-topic",
    credential: {
      credential_ref: "notifications:ntfy",
      configured: true,
      source: "user",
      updated_at: "2026-07-23T00:00:00.000Z",
    },
  },
  bark: {
    enabled: true,
    base_url: "https://api.day.app",
    credential: {
      credential_ref: "notifications:bark",
      configured: true,
      source: "user",
      updated_at: "2026-07-23T00:00:00.000Z",
    },
  },
};

const notificationsEnvelope = (data = CONFIGURED_NOTIFICATIONS, revision = 9) => ({
  data,
  revision,
  loaded_at: "2026-07-23T00:00:00.000Z",
  source_path: "/tmp/credentials.json",
  source_kind: "file" as const,
  status: "healthy" as const,
  last_error: null,
});

function openSelect(trigger: Element) {
  fireEvent.mouseDown(trigger.querySelector(".ant-select-selector") ?? trigger);
}

describe("NotificationChannelsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfigSectionStore.getState().reset();
    vi.spyOn(configSectionsService, "getSection").mockResolvedValue(
      notificationsEnvelope() as never,
    );
    vi.spyOn(configSectionsService, "putNotifications").mockResolvedValue(
      notificationsEnvelope(undefined, 10),
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it("never prefills a masked secret into the token/device-key inputs", async () => {
    render(<NotificationChannelsSection />);

    const tokenInput = (await screen.findByTestId("channel-ntfy-token")) as HTMLInputElement;
    const deviceKeyInput = (await screen.findByTestId(
      "channel-bark-device-key",
    )) as HTMLInputElement;

    expect(tokenInput.value).toBe("");
    expect(deviceKeyInput.value).toBe("");
    // Non-secret fields still load from the server response.
    expect((await screen.findByTestId("channel-ntfy-topic")) as HTMLInputElement).toHaveValue(
      "my-topic",
    );
  });

  it("omits an untouched secret from the save payload (server keeps the stored value)", async () => {
    render(<NotificationChannelsSection />);
    await screen.findByTestId("channel-ntfy-token");

    fireEvent.click(screen.getByTestId("channel-save-button"));

    await waitFor(() => expect(configSectionsService.putNotifications).toHaveBeenCalledTimes(1));
    const [revision, patch] = vi.mocked(configSectionsService.putNotifications).mock.calls[0];
    expect(revision).toBe(9);
    expect(patch.ntfy).not.toHaveProperty("token");
    expect(patch.bark).not.toHaveProperty("device_key");
  });

  it("sends the new plaintext value when a secret is edited", async () => {
    render(<NotificationChannelsSection />);
    const tokenInput = await screen.findByTestId("channel-ntfy-token");

    fireEvent.change(tokenInput, { target: { value: "tk-new-secret" } });
    fireEvent.click(screen.getByTestId("channel-save-button"));

    await waitFor(() => expect(configSectionsService.putNotifications).toHaveBeenCalledTimes(1));
    const [, patch] = vi.mocked(configSectionsService.putNotifications).mock.calls[0];
    expect(patch.ntfy.token).toBe("tk-new-secret");
  });

  it("round-trips the desktop tri-state 'auto' as null when left untouched", async () => {
    render(<NotificationChannelsSection />);
    await screen.findByTestId("channel-ntfy-token");

    fireEvent.click(screen.getByTestId("channel-save-button"));

    await waitFor(() => expect(configSectionsService.putNotifications).toHaveBeenCalledTimes(1));
    const [, patch] = vi.mocked(configSectionsService.putNotifications).mock.calls[0];
    expect(patch.desktop.enabled).toBeNull();
  });

  it("sends explicit true/false when the desktop mode is switched to On/Off", async () => {
    render(<NotificationChannelsSection />);
    const select = await screen.findByTestId("channel-desktop-mode");
    openSelect(select);
    fireEvent.click(await screen.findByText("On"));

    fireEvent.click(screen.getByTestId("channel-save-button"));

    await waitFor(() => expect(configSectionsService.putNotifications).toHaveBeenCalledTimes(1));
    const [, patch] = vi.mocked(configSectionsService.putNotifications).mock.calls[0];
    expect(patch.desktop.enabled).toBe(true);
  });

  it("shows attempted channels on a successful test", async () => {
    mockAgentPost.mockResolvedValueOnce({ attempted: ["ntfy", "bark"] });
    render(<NotificationChannelsSection />);
    await screen.findByTestId("channel-ntfy-token");

    fireEvent.click(screen.getByTestId("channel-test-button"));

    await waitFor(() => {
      expect(mockAgentPost).toHaveBeenCalledWith("notifications/test");
    });
    expect(await screen.findByText(/ntfy, bark/)).toBeInTheDocument();
  });

  it("shows an error message when the test send fails", async () => {
    mockAgentPost.mockRejectedValueOnce(new Error("network down"));
    render(<NotificationChannelsSection />);
    await screen.findByTestId("channel-ntfy-token");

    fireEvent.click(screen.getByTestId("channel-test-button"));

    expect(await screen.findByText("network down")).toBeInTheDocument();
  });
});
