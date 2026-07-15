import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConfigRecoveryStore } from "../configRecoveryStore";
import { serviceFactory } from "@services/common/ServiceFactory";

const PENDING_SALVAGED = {
  pending: true,
  status: {
    source: { kind: "salvaged", fields: ["http_proxy"] },
    quarantine_path: "/data/config.json.corrupted.123",
    confirmed: false,
  },
} as const;

describe("useConfigRecoveryStore", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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

  it("checkStatus reflects a pending recovery from the backend", async () => {
    const spy = vi
      .spyOn(serviceFactory, "getConfigRecoveryStatus")
      .mockResolvedValue(PENDING_SALVAGED as any);

    await useConfigRecoveryStore.getState().checkStatus();

    expect(spy).toHaveBeenCalledTimes(1);
    const state = useConfigRecoveryStore.getState();
    expect(state.pending).toBe(true);
    expect(state.checked).toBe(true);
    expect(state.status?.source).toEqual({ kind: "salvaged", fields: ["http_proxy"] });
  });

  it("checkStatus reflects no pending recovery", async () => {
    vi.spyOn(serviceFactory, "getConfigRecoveryStatus").mockResolvedValue({ pending: false });

    await useConfigRecoveryStore.getState().checkStatus();

    const state = useConfigRecoveryStore.getState();
    expect(state.pending).toBe(false);
    expect(state.status).toBeNull();
    expect(state.checked).toBe(true);
  });

  it("dedupes concurrent checkStatus calls", async () => {
    const spy = vi.spyOn(serviceFactory, "getConfigRecoveryStatus").mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return { pending: false };
    });

    await Promise.all([
      useConfigRecoveryStore.getState().checkStatus(),
      useConfigRecoveryStore.getState().checkStatus(),
    ]);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not re-fetch once checked unless force is passed", async () => {
    const spy = vi
      .spyOn(serviceFactory, "getConfigRecoveryStatus")
      .mockResolvedValue({ pending: false });

    await useConfigRecoveryStore.getState().checkStatus();
    await useConfigRecoveryStore.getState().checkStatus();
    expect(spy).toHaveBeenCalledTimes(1);

    await useConfigRecoveryStore.getState().checkStatus({ force: true });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("resolve(true) accepts and clears the pending flag", async () => {
    useConfigRecoveryStore.setState(PENDING_SALVAGED as any);
    const spy = vi
      .spyOn(serviceFactory, "confirmConfigRecovery")
      .mockResolvedValue({ pending: false });

    await useConfigRecoveryStore.getState().resolve(true);

    expect(spy).toHaveBeenCalledWith(true);
    const state = useConfigRecoveryStore.getState();
    expect(state.pending).toBe(false);
    expect(state.lastAction).toBe("accept");
  });

  it("resolve(false) is a no-op on the backend and leaves pending true", async () => {
    useConfigRecoveryStore.setState(PENDING_SALVAGED as any);
    const spy = vi
      .spyOn(serviceFactory, "confirmConfigRecovery")
      .mockResolvedValue(PENDING_SALVAGED as any);

    await useConfigRecoveryStore.getState().resolve(false);

    expect(spy).toHaveBeenCalledWith(false);
    const state = useConfigRecoveryStore.getState();
    expect(state.pending).toBe(true);
    expect(state.lastAction).toBe("reject");
  });

  it("resolve surfaces an error and rethrows on failure", async () => {
    vi.spyOn(serviceFactory, "confirmConfigRecovery").mockRejectedValue(new Error("boom"));

    await expect(useConfigRecoveryStore.getState().resolve(true)).rejects.toThrow("boom");
    expect(useConfigRecoveryStore.getState().error).toBe("boom");
    expect(useConfigRecoveryStore.getState().resolving).toBe(false);
  });
});
