import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
      state: "configured" as const,
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
      state: "configured" as const,
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
    expect(patch.ntfy).not.toHaveProperty("credential_change");
    expect(patch.bark).not.toHaveProperty("credential_change");
  });

  it("sends the new plaintext value when a secret is edited", async () => {
    render(<NotificationChannelsSection />);
    const tokenInput = await screen.findByTestId("channel-ntfy-token");

    fireEvent.change(tokenInput, { target: { value: "tk-new-secret" } });
    fireEvent.click(screen.getByTestId("channel-save-button"));

    await waitFor(() => expect(configSectionsService.putNotifications).toHaveBeenCalledTimes(1));
    const [, patch] = vi.mocked(configSectionsService.putNotifications).mock.calls[0];
    expect(patch.ntfy.credential_change).toEqual({
      action: "replace",
      value: "tk-new-secret",
    });
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

  it("adopts a newer notification snapshot while the form is clean", async () => {
    render(<NotificationChannelsSection />);
    const topic = (await screen.findByTestId("channel-ntfy-topic")) as HTMLInputElement;

    act(() => {
      useConfigSectionStore.setState((state) => ({
        sections: {
          ...state.sections,
          notifications: {
            ...state.sections.notifications,
            envelope: notificationsEnvelope(
              {
                ...CONFIGURED_NOTIFICATIONS,
                ntfy: { ...CONFIGURED_NOTIFICATIONS.ntfy, topic: "remote-topic" },
              },
              10,
            ),
          },
        },
      }));
    });

    await waitFor(() => expect(topic).toHaveValue("remote-topic"));
    expect(screen.queryByText(/changed on disk/i)).not.toBeInTheDocument();
  });

  it("preserves a dirty draft and compares revisions without showing replacement secrets", async () => {
    render(<NotificationChannelsSection />);
    const topic = (await screen.findByTestId("channel-ntfy-topic")) as HTMLInputElement;
    const token = screen.getByTestId("channel-ntfy-token");
    fireEvent.change(topic, { target: { value: "local-topic" } });
    fireEvent.change(token, { target: { value: "do-not-display" } });

    act(() => {
      useConfigSectionStore.setState((state) => ({
        sections: {
          ...state.sections,
          notifications: {
            ...state.sections.notifications,
            envelope: notificationsEnvelope(
              {
                ...CONFIGURED_NOTIFICATIONS,
                ntfy: { ...CONFIGURED_NOTIFICATIONS.ntfy, topic: "remote-topic" },
              },
              10,
            ),
          },
        },
      }));
    });

    expect(await screen.findByText(/changed on disk/i)).toBeInTheDocument();
    expect(topic).toHaveValue("local-topic");
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    const comparison = screen.getByTestId("notification-revision-comparison");
    expect(comparison).toHaveTextContent("local-topic");
    expect(comparison).toHaveTextContent("remote-topic");
    expect(comparison).toHaveTextContent("[replace requested]");
    expect(comparison).not.toHaveTextContent("do-not-display");

    fireEvent.click(screen.getByTestId("channel-save-button"));
    await waitFor(() => expect(configSectionsService.putNotifications).toHaveBeenCalled());
    expect(vi.mocked(configSectionsService.putNotifications).mock.calls[0]?.[0]).toBe(9);
  });

  it("reapplies a dirty draft onto the latest revision before saving", async () => {
    render(<NotificationChannelsSection />);
    const topic = (await screen.findByTestId("channel-ntfy-topic")) as HTMLInputElement;
    fireEvent.change(topic, { target: { value: "local-topic" } });

    act(() => {
      useConfigSectionStore.setState((state) => ({
        sections: {
          ...state.sections,
          notifications: {
            ...state.sections.notifications,
            envelope: notificationsEnvelope(
              {
                ...CONFIGURED_NOTIFICATIONS,
                ntfy: {
                  ...CONFIGURED_NOTIFICATIONS.ntfy,
                  base_url: "https://remote.example",
                  topic: "remote-topic",
                },
              },
              10,
            ),
          },
        },
      }));
    });

    fireEvent.click(await screen.findByRole("button", { name: "Reapply" }));
    expect(topic).toHaveValue("local-topic");
    expect(screen.getByTestId("channel-ntfy-base-url")).toHaveValue("https://remote.example");
    fireEvent.click(screen.getByTestId("channel-save-button"));

    await waitFor(() => expect(configSectionsService.putNotifications).toHaveBeenCalled());
    expect(vi.mocked(configSectionsService.putNotifications).mock.calls[0]?.[0]).toBe(10);
  });

  it("queues an explicit clear without discarding another unsaved secret replacement", async () => {
    render(<NotificationChannelsSection />);
    const barkKey = await screen.findByTestId("channel-bark-device-key");
    fireEvent.change(barkKey, { target: { value: "new-bark-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear configured token" }));

    expect(configSectionsService.putNotifications).not.toHaveBeenCalled();
    expect(barkKey).toHaveValue("new-bark-secret");
    fireEvent.click(screen.getByTestId("channel-save-button"));

    await waitFor(() => expect(configSectionsService.putNotifications).toHaveBeenCalled());
    const [, patch] = vi.mocked(configSectionsService.putNotifications).mock.calls[0]!;
    expect(patch.ntfy.credential_change).toEqual({ action: "clear" });
    expect(patch.bark.credential_change).toEqual({
      action: "replace",
      value: "new-bark-secret",
    });
  });
});
