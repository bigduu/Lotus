/**
 * Lightweight registry of models the user has actually selected and sent a
 * message with.
 *
 * This drives the Model Limits settings list: only models you've really used
 * show up (so the table stays short and personal), each defaulting to the
 * backend's global default until you override it.
 *
 * Stored client-side in localStorage — it is a discovery convenience only. The
 * authoritative token budget always comes from the backend (provider runtime
 * metadata or persisted overrides), independent of this list.
 */
const STORAGE_KEY = "zenith.usedModels.v1";

function readRaw(): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((m): m is string => typeof m === "string" && m.trim().length > 0);
  } catch {
    return [];
  }
}

/** Models the user has used, most-recently-used first. */
export function getUsedModels(): string[] {
  return readRaw();
}

/**
 * Record that `model` was used. No-ops for empty values or on the server.
 * Moves an already-known model to the front. Returns the updated list.
 */
export function recordUsedModel(model: string | undefined | null): string[] {
  const normalized = typeof model === "string" ? model.trim() : "";
  if (!normalized || typeof window === "undefined") {
    return readRaw();
  }

  const existing = readRaw().filter((m) => m !== normalized);
  const next = [normalized, ...existing];
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage failures (quota / disabled) — discovery is best-effort.
  }
  return next;
}

/**
 * Remove a model from the registry. Returns the updated list. Used to clean up
 * the Model Limits discovery list (e.g. a model recorded in error).
 */
export function removeUsedModel(model: string | undefined | null): string[] {
  const normalized = typeof model === "string" ? model.trim() : "";
  if (!normalized || typeof window === "undefined") {
    return readRaw();
  }
  const next = readRaw().filter((m) => m !== normalized);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage failures — best-effort.
  }
  return next;
}

/** Clear the registry (used by tests and "reset" affordances). */
export function clearUsedModels(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
