/**
 * Device-credential storage for the API v2 per-device token scheme
 * (bamboo #181/#188/#191/#195; epic #26 phase 1 — wire plumbing only, no UI
 * yet). A "device credential" is the `{device_id, token}` pair minted by
 * `POST /v2/pair` (or refreshed by `POST /v2/devices/{id}/rotate`) and is
 * presented back to the backend on the `/v2/stream` WebSocket `hello` frame
 * (see `v2Stream.ts`) so a non-loopback client (mobile / remote) can
 * authenticate without the root password.
 *
 * localStorage-backed, mirroring the defensive read/write pattern used by
 * `backendBaseUrl.ts` (parse-or-treat-as-absent on any failure — a corrupt or
 * foreign value must never throw up into a caller, it just reads back as "no
 * credential stored").
 *
 * Desktop/loopback deployments never call `setDeviceCredential`, so
 * `getDeviceCredential()` returns `null` there and every consumer (currently
 * just `v2Stream.ts`'s hello frame) stays a byte-for-byte no-op.
 */

const DEVICE_CREDENTIAL_KEY = "bamboo_device_credential";

export interface DeviceCredential {
  device_id: string;
  token: string;
}

const isDeviceCredential = (value: unknown): value is DeviceCredential =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Record<string, unknown>).device_id === "string" &&
  (value as Record<string, unknown>).device_id !== "" &&
  typeof (value as Record<string, unknown>).token === "string" &&
  (value as Record<string, unknown>).token !== "";

/**
 * Read the stored device credential, if any. Returns `null` when nothing is
 * stored, or when the stored value is corrupt / malformed / not a
 * `{device_id, token}` pair — never throws.
 */
export const getDeviceCredential = (): DeviceCredential | null => {
  try {
    const raw = localStorage.getItem(DEVICE_CREDENTIAL_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isDeviceCredential(parsed)) {
      return null;
    }
    return { device_id: parsed.device_id, token: parsed.token };
  } catch {
    return null;
  }
};

/**
 * Persist a device credential (e.g. the result of `pairDevice`/`rotateDevice`
 * in `ServiceFactory.ts`). Best-effort: a storage failure (private mode,
 * quota, disabled storage) is swallowed rather than thrown, matching
 * `backendBaseUrl.ts`'s defensive posture.
 */
export const setDeviceCredential = (credential: DeviceCredential): void => {
  try {
    localStorage.setItem(DEVICE_CREDENTIAL_KEY, JSON.stringify(credential));
  } catch {
    // Storage unavailable — nothing to do; the credential simply won't
    // survive a reload, mirroring other best-effort localStorage writes.
  }
};

/** Remove any stored device credential (e.g. after a revoke). Best-effort. */
export const clearDeviceCredential = (): void => {
  try {
    localStorage.removeItem(DEVICE_CREDENTIAL_KEY);
  } catch {
    // Storage unavailable — nothing to do.
  }
};
