const SENSITIVE_NAME = String.raw`(?:token|password|secret|api[_-]?key|authorization|private[_-]?key|device[_-]?key|client[_-]?secret|app[_-]?secret|passphrase)`;

/**
 * Redact credential-shaped values before a configuration error enters UI or
 * store state. The backend already returns secret-free diagnostics; this is a
 * fail-closed client boundary for proxy errors and forward-compatible fields.
 */
export const redactConfigError = (value: string): string => {
  const redacted = value
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/gi, "[redacted private key]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, "$1[redacted]@")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/._~=-]+/gi, "$1 [redacted]")
    .replace(new RegExp(`("${SENSITIVE_NAME}"\\s*:\\s*)"[^"]*"`, "gi"), '$1"[redacted]"')
    .replace(
      new RegExp(`(\\b${SENSITIVE_NAME}\\b\\s*[:=]\\s*)('[^']*'|"[^"]*"|[^\\s,;}\\]]+)`, "gi"),
      "$1[redacted]",
    )
    .replace(new RegExp(`([?&]${SENSITIVE_NAME}=)[^&#\\s]*`, "gi"), "$1[redacted]");
  return redacted.length > 2_000 ? `${redacted.slice(0, 2_000)}… [truncated]` : redacted;
};

/**
 * Convert an unknown configuration failure into a user-safe message.
 *
 * Keeping this conversion next to the redactor prevents component-local
 * catch blocks and console diagnostics from bypassing the store boundary.
 */
export const configErrorMessage = (error: unknown, fallback: string): string =>
  redactConfigError(
    error instanceof Error && error.message.trim().length > 0 ? error.message : fallback,
  );
