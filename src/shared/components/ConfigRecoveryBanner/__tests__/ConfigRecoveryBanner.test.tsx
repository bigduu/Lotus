import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigRecoveryBanner } from "../index";
import { useConfigRecoveryStore } from "@shared/store/configRecoveryStore";

const { mockGetConfigRecoveryStatus, mockConfirmConfigRecovery } = vi.hoisted(() => ({
  mockGetConfigRecoveryStatus: vi.fn(),
  mockConfirmConfigRecovery: vi.fn(),
}));

vi.mock("@services/common/ServiceFactory", () => ({
  serviceFactory: {
    getConfigRecoveryStatus: mockGetConfigRecoveryStatus,
    confirmConfigRecovery: mockConfirmConfigRecovery,
  },
}));

const PENDING_BACKUP = {
  pending: true,
  status: {
    source: { kind: "backup", generation: 0 },
    quarantine_path: "/data/config.json.corrupted.999",
    confirmed: false,
  },
};

describe("ConfigRecoveryBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfigRecoveryStore.setState({
      pending: false,
      status: null,
      checked: false,
      loading: false,
      lastAction: null,
      resolving: false,
      error: null,
    });
  });

  it("renders nothing while no recovery is pending", async () => {
    mockGetConfigRecoveryStatus.mockResolvedValue({ pending: false });

    render(<ConfigRecoveryBanner />);

    await waitFor(() => expect(mockGetConfigRecoveryStatus).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("config-recovery-banner")).not.toBeInTheDocument();
  });

  it("shows the banner with source + quarantine path when a recovery is pending", async () => {
    mockGetConfigRecoveryStatus.mockResolvedValue(PENDING_BACKUP);

    render(<ConfigRecoveryBanner />);

    const banner = await screen.findByTestId("config-recovery-banner");
    expect(banner).toBeInTheDocument();
    expect(screen.getByTestId("config-recovery-source")).toHaveTextContent("generation 0");
    expect(screen.getByTestId("config-recovery-quarantine-path")).toHaveTextContent(
      "/data/config.json.corrupted.999",
    );
  });

  it("accept calls confirm(true) and clears the banner once the store reports resolved", async () => {
    mockGetConfigRecoveryStatus.mockResolvedValue(PENDING_BACKUP);
    mockConfirmConfigRecovery.mockResolvedValue({ pending: false });

    render(<ConfigRecoveryBanner />);
    await screen.findByTestId("config-recovery-banner");

    fireEvent.click(screen.getByTestId("config-recovery-accept"));

    await waitFor(() => expect(mockConfirmConfigRecovery).toHaveBeenCalledWith(true));
    await waitFor(() =>
      expect(screen.queryByTestId("config-recovery-banner")).not.toBeInTheDocument(),
    );
  });

  it("reject calls confirm(false) but the banner stays (backend leaves pending untouched)", async () => {
    mockGetConfigRecoveryStatus.mockResolvedValue(PENDING_BACKUP);
    // Reject is a backend no-op: the response still reports pending: true.
    mockConfirmConfigRecovery.mockResolvedValue(PENDING_BACKUP);

    render(<ConfigRecoveryBanner />);
    await screen.findByTestId("config-recovery-banner");

    fireEvent.click(screen.getByTestId("config-recovery-reject"));

    await waitFor(() => expect(mockConfirmConfigRecovery).toHaveBeenCalledWith(false));
    expect(await screen.findByTestId("config-recovery-reject-notice")).toBeInTheDocument();
    expect(screen.getByTestId("config-recovery-banner")).toBeInTheDocument();
  });
});
