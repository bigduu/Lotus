import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SystemSettingsNotificationsTab from "../SystemSettingsNotificationsTab";

const { mockGetPreferences, mockSetPreferences } = vi.hoisted(() => ({
  mockGetPreferences: vi.fn(),
  mockSetPreferences: vi.fn(),
}));

vi.mock("@services/notification/notificationPreferencesApi", () => ({
  getNotificationPreferences: mockGetPreferences,
  setNotificationPreferences: mockSetPreferences,
}));

vi.mock("../../../../../utils/environment", () => ({
  isTauriEnvironment: () => true,
}));

// The channels section has its own dedicated test file; stub it out here so
// this file only exercises the preferences card.
vi.mock("../NotificationChannelsSection", () => ({
  default: () => <div data-testid="channels-section-stub" />,
}));

vi.mock("antd", async () => {
  const actual = await vi.importActual<typeof import("antd")>("antd");
  const message = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
  };
  const notification = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  };
  const modal = {
    confirm: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  };
  return {
    ...actual,
    message,
    notification,
    App: Object.assign(actual.App, {
      useApp: () => ({ message, notification, modal }),
    }),
  };
});

const FULL_PREFS = {
  enabled: true,
  onClarification: true,
  onToolApproval: true,
  onContextPressure: true,
  onSubAgentComplete: true,
  onBackgroundTaskComplete: true,
  onRunComplete: true,
  onRunFailed: true,
};

describe("SystemSettingsNotificationsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPreferences.mockResolvedValue(FULL_PREFS);
    mockSetPreferences.mockImplementation(async (next) => next);
  });

  it("renders the run-complete/run-failed toggles alongside existing categories", async () => {
    render(<SystemSettingsNotificationsTab />);

    expect(await screen.findByTestId("notification-run-complete-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("notification-run-failed-toggle")).toBeInTheDocument();
  });

  it("PUTs the full preference set, including the new fields, when any toggle flips", async () => {
    render(<SystemSettingsNotificationsTab />);

    const toggle = await screen.findByTestId("notification-run-complete-toggle");
    await waitFor(() => expect(toggle).not.toBeDisabled());
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockSetPreferences).toHaveBeenCalledWith({
        ...FULL_PREFS,
        onRunComplete: false,
      });
    });
  });

  it("reverts the optimistic update and shows an error toast on save failure", async () => {
    const { message } = await import("antd");
    mockSetPreferences.mockRejectedValueOnce(new Error("boom"));

    render(<SystemSettingsNotificationsTab />);
    const toggle = await screen.findByTestId("notification-run-failed-toggle");
    await waitFor(() => expect(toggle).not.toBeDisabled());
    fireEvent.click(toggle);

    await waitFor(() => expect(message.error).toHaveBeenCalled());
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it("renders the notification channels section", async () => {
    render(<SystemSettingsNotificationsTab />);
    expect(await screen.findByTestId("channels-section-stub")).toBeInTheDocument();
  });
});
