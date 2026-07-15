/**
 * Shared "masked secret" contract for settings forms.
 *
 * The backend redacts configured secrets (provider `api_key`, ntfy `token`,
 * Bark `device_key`, cluster SSH credentials, ...) to the literal
 * `****...****` in GET responses. Frontend editors must never prefill that
 * placeholder into an editable field — a paste that doesn't fully clear the
 * placeholder would produce `****...****sk-new…`, which used to be treated as
 * "keep the old secret" and silently discarded the new value (bamboo #430).
 *
 * `isMaskedSecret` is the client-side twin of Rust's `is_masked_api_key` in
 * bamboo/crates/infra/bamboo-config/src/patch.rs: a value counts as "masked"
 * only if it is non-empty and every character is `*` or `.` (an exact
 * structural match, not a substring check).
 *
 * Contract for any field using this predicate:
 * - On load: if the fetched value `isMaskedSecret`, start the input empty
 *   (never prefill the mask) and show a "configured, leave blank to keep"
 *   placeholder instead.
 * - On save: an empty input on an already-configured field means "keep the
 *   stored secret" — omit the field from the save payload entirely. A
 *   non-empty input is sent as the new plaintext value. The mask string
 *   itself must never be round-tripped back to the server.
 */
export const isMaskedSecret = (value: unknown): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  [...value.trim()].every((c) => c === "*" || c === ".");

/** Object-key fragments that mark a field as sensitive, matched case-insensitively. */
const SENSITIVE_KEY_PATTERNS = ["api_key", "apikey", "token", "secret", "password"];

const isSensitiveKey = (key: string): boolean => {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((pattern) => lower.includes(pattern));
};

const REDACTED_PLACEHOLDER = "***redacted***";

/**
 * Deep-clones a config-shaped value, replacing any value whose key looks
 * sensitive (`api_key`, `api_key_encrypted`, `token`, `secret`, `password`,
 * ...) with a fixed placeholder. Intended for `debugLog`/`console.log`
 * call sites that pass a raw settings/provider payload — those payloads
 * carry plaintext credentials (`providers.{provider}.api_key`, etc.) that
 * must never land in the console, even behind the dev-only verbose flag.
 *
 * Non-sensitive values are passed through unchanged (same array/object
 * shape, just filtered), so the redacted object is still useful for
 * debugging structure/counts/ids.
 */
export const redactSensitive = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, val]) => {
      if (isSensitiveKey(key)) {
        return [key, val == null || val === "" ? val : REDACTED_PLACEHOLDER] as const;
      }
      return [key, redactSensitive(val)] as const;
    });
    return Object.fromEntries(entries) as T;
  }
  return value;
};
