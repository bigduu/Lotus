import { create } from "zustand";
import { serviceFactory, type ConfigRecoveryStatusInfo } from "@services/common/ServiceFactory";

type LoadOptions = { force?: boolean };

interface ConfigRecoveryState {
  /** `true` once a `config.json` corruption recovery is confirmed pending. */
  pending: boolean;
  status: ConfigRecoveryStatusInfo | null;
  /** Whether a status check has completed at least once (distinguishes
   *  "not checked yet" from "checked, nothing pending"). */
  checked: boolean;
  loading: boolean;
  /** Set right after a resolve() call so the banner can show reject-specific
   *  copy (reject is a no-op — it does NOT clear `pending`). */
  lastAction: "accept" | "reject" | null;
  resolving: boolean;
  error: string | null;

  checkStatus: (options?: LoadOptions) => Promise<void>;
  resolve: (accept: boolean) => Promise<void>;
}

let checkInFlight: Promise<void> | null = null;

const toMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.trim() ? error.message : fallback;

/**
 * Config-corruption recovery status (Lotus #59, consuming bamboo #153 / PR
 * #493's `GET/POST /bamboo/config/recovery-*` API).
 *
 * `config.json` load-time corruption recovery (salvage / `.bak` / defaults)
 * is quarantine-and-recover-but-never-auto-persist: the backend refuses every
 * settings write (409 `config_recovery_pending`) until the user explicitly
 * accepts or rejects via `POST /bamboo/config/recovery/confirm`. This store
 * is the single source of truth the `ConfigRecoveryBanner` (mounted globally
 * in `MainLayout`) and any settings-save error handling read from.
 */
export const useConfigRecoveryStore = create<ConfigRecoveryState>((set, get) => ({
  pending: false,
  status: null,
  checked: false,
  loading: false,
  lastAction: null,
  resolving: false,
  error: null,

  checkStatus: async ({ force = false }: LoadOptions = {}) => {
    if (!force && get().checked) {
      return;
    }
    if (checkInFlight) {
      return checkInFlight;
    }

    checkInFlight = (async () => {
      set({ loading: true, error: null });
      try {
        const res = await serviceFactory.getConfigRecoveryStatus();
        set({
          pending: res.pending,
          status: res.status ?? null,
          checked: true,
        });
      } catch (error) {
        set({ error: toMessage(error, "Failed to check config recovery status") });
      } finally {
        set({ loading: false });
      }
    })();

    try {
      await checkInFlight;
    } finally {
      checkInFlight = null;
    }
  },

  resolve: async (accept: boolean) => {
    set({ resolving: true, error: null });
    try {
      const res = await serviceFactory.confirmConfigRecovery(accept);
      set({
        pending: res.pending,
        status: res.status ?? null,
        checked: true,
        lastAction: accept ? "accept" : "reject",
      });
    } catch (error) {
      set({
        error: toMessage(
          error,
          accept ? "Failed to accept the config recovery" : "Failed to reject the config recovery",
        ),
      });
      throw error;
    } finally {
      set({ resolving: false });
    }
  },
}));
