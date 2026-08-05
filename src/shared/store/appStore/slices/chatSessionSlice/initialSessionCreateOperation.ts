import type { CreateSessionRequest } from "@services/chat/AgentService";
import { createSessionIdempotencyKey } from "@services/chat/sessionCreateIdempotency";

const STORAGE_KEY = "lotus.session-create.initial-operation.v1";
const STORAGE_VERSION = 1;

export interface InitialSessionCreateOperation {
  idempotencyKey: string;
  createdAtMs: number;
  request: CreateSessionRequest;
}

export interface AcquiredInitialSessionCreateOperation {
  operation: InitialSessionCreateOperation;
  isNew: boolean;
}

interface StoredInitialSessionCreateOperation extends InitialSessionCreateOperation {
  version: typeof STORAGE_VERSION;
}

// `undefined` means storage has not been hydrated; `null` means it was checked
// and no operation exists. The in-memory copy also serializes concurrent
// loadChats calls before either one reaches the network.
let cachedOperation: InitialSessionCreateOperation | null | undefined;

const getSessionStorage = (): Storage | null => {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseStoredOperation = (value: string): InitialSessionCreateOperation | null => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !isObjectRecord(parsed) ||
      parsed.version !== STORAGE_VERSION ||
      typeof parsed.idempotencyKey !== "string" ||
      !parsed.idempotencyKey.trim() ||
      typeof parsed.createdAtMs !== "number" ||
      !Number.isFinite(parsed.createdAtMs) ||
      !isObjectRecord(parsed.request)
    ) {
      return null;
    }

    return {
      idempotencyKey: parsed.idempotencyKey,
      createdAtMs: parsed.createdAtMs,
      request: parsed.request as CreateSessionRequest,
    };
  } catch {
    return null;
  }
};

const hydrateOperation = (): InitialSessionCreateOperation | null => {
  if (cachedOperation !== undefined) {
    return cachedOperation;
  }

  const storage = getSessionStorage();
  if (!storage) {
    cachedOperation = null;
    return cachedOperation;
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);
    cachedOperation = raw ? parseStoredOperation(raw) : null;
    if (raw && !cachedOperation) {
      storage.removeItem(STORAGE_KEY);
    }
  } catch {
    cachedOperation = null;
  }

  return cachedOperation;
};

const canonicalizeRequest = (request: CreateSessionRequest): CreateSessionRequest =>
  JSON.parse(JSON.stringify(request)) as CreateSessionRequest;

export function acquireInitialSessionCreateOperation(
  request: CreateSessionRequest,
): AcquiredInitialSessionCreateOperation {
  const existing = hydrateOperation();
  if (existing) {
    return { operation: existing, isNew: false };
  }

  const operation: InitialSessionCreateOperation = {
    idempotencyKey: createSessionIdempotencyKey(),
    createdAtMs: Date.now(),
    // Persist the exact JSON request that the first POST will put on the wire.
    // A later reload must not substitute changed provider defaults or locale.
    request: canonicalizeRequest(request),
  };
  cachedOperation = operation;

  const stored: StoredInitialSessionCreateOperation = {
    version: STORAGE_VERSION,
    ...operation,
  };
  try {
    getSessionStorage()?.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // The in-memory copy still prevents duplicate same-page startup attempts.
  }

  return { operation, isNew: true };
}

/** Return a previously-persisted startup operation without allocating one. */
export function getInitialSessionCreateOperation(): InitialSessionCreateOperation | null {
  return hydrateOperation();
}

export function clearInitialSessionCreateOperation(): void {
  cachedOperation = null;
  try {
    getSessionStorage()?.removeItem(STORAGE_KEY);
  } catch {
    // Storage may be unavailable in privacy-restricted embedded WebViews.
  }
}

/** Simulate a same-tab document reload while preserving sessionStorage. */
export function resetInitialSessionCreateOperationMemoryForTest(): void {
  cachedOperation = undefined;
}
