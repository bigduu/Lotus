import { create } from "zustand";

/** Legacy whole-state blob retained only for one-way v1 migration. */
export const SESSION_READ_STATE_STORAGE_KEY = "lotus.sidebar.session-read-state.v1";
export const SESSION_READ_STATE_META_STORAGE_KEY =
  "lotus.sidebar.session-read-state.v2.initialized";
export const SESSION_READ_STATE_MIGRATION_STORAGE_KEY =
  "lotus.sidebar.session-read-state.v2.legacy-migrated";
export const SESSION_READ_STATE_MARKER_STORAGE_PREFIX =
  "lotus.sidebar.session-read-state.v2.marker.";
export const SESSION_READ_STATE_RESET_STORAGE_PREFIX = "lotus.sidebar.session-read-state.v2.reset.";
export const SESSION_READ_STATE_PENDING_RESET_STORAGE_PREFIX =
  "lotus.sidebar.session-read-state.v2.pending-reset.";

export type SessionActivity = {
  id: string;
  lastActivityAt?: string | null;
  updatedAt?: string | null;
  messageCount?: number | null;
};

/**
 * The content revision observed when a session was last read. `activityAt`
 * orders two snapshots of the same session; for modern summaries unread is
 * still determined exclusively from `messageCount` (see `isSessionUnread`).
 */
export type SessionReadMarker = {
  activityAt: number;
  /** Nanosecond remainder within activityAt's millisecond (six digits). */
  activityRevision: string;
  messageCount: number;
  hasMessageCount: boolean;
  /** Greatest durable account-feed content coordinate observed for this session. */
  dirtyContentThrough?: number;
  /** Greatest content coordinate this tab actually rendered before acknowledging. */
  readContentThrough?: number;
  /** Greatest account-level feed-reset watermark rendered for this session. */
  readResetThrough?: number;
};

export type SessionReadObservation = {
  content?: number;
  reset?: number;
};

type PersistedSessionReadState = {
  v: 1;
  initialized: boolean;
  markers: Record<string, SessionReadMarker>;
};

type PersistedSessionReadMarkerEntry = {
  v: 2;
  sessionId: string;
  marker: SessionReadMarker;
};

type SessionReadState = {
  v: 2;
  initialized: boolean;
  markers: Record<string, SessionReadMarker>;
  /** Greatest server feed prefix known to contain an unreplayable gap. */
  feedResetThrough: number;
  /** A reset survived locally but its authoritative server head is still loading. */
  pendingFeedReset: boolean;
  initialize: (sessions: ReadonlyArray<SessionActivity>) => void;
  markRead: (
    sessions: ReadonlyArray<SessionActivity>,
    observed?: Readonly<Record<string, SessionReadObservation | undefined>>,
  ) => void;
  /** Returns true only after the dirty coordinate is verified durable. */
  markUnreadFromFeed: (sessionId: string, feedSeq: number) => boolean;
  beginFeedReset: () => { token: string; durable: boolean };
  pendingFeedResetTokens: () => string[];
  /** Resolves only the supplied pending resets at a server snapshot watermark. */
  resolveFeedResets: (tokens: ReadonlyArray<string>, feedHead: number) => boolean;
  applyPersistedState: (state: {
    initialized: boolean;
    markers: Readonly<Record<string, SessionReadMarker>>;
    feedResetThrough: number;
    pendingFeedReset: boolean;
  }) => void;
};

const EMPTY_PERSISTED_STATE = {
  initialized: false,
  markers: {} as Record<string, SessionReadMarker>,
  feedResetThrough: 0,
  pendingFeedReset: false,
};

const parseTimestamp = (value?: string | null): number => {
  if (!value?.trim()) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseSubmillisecondRevision = (value?: string | null): string => {
  if (!value?.trim()) return "";
  const match = value.trim().match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/i);
  if (!match) return "000000";
  // Normalize the fraction to nanoseconds, then retain the six digits below
  // JavaScript's millisecond precision. `.000001Z` becomes `001000`.
  const fraction = match[1].padEnd(9, "0").slice(0, 9);
  return fraction.slice(3);
};

const normalizeMessageCount = (value?: number | null): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

const isSafeCoordinate = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/**
 * Build the observed content signature. Bamboo currently aliases
 * `lastActivityAt` to metadata-tainted `updatedAt`, so the timestamp is useful
 * for ordering snapshots (including a legitimate count reset) but not for
 * deciding unread status when a finite message count is present.
 */
export const getSessionActivityMarker = (session: SessionActivity): SessionReadMarker => {
  const lastActivityAt = parseTimestamp(session.lastActivityAt);
  const hasMessageCount =
    typeof session.messageCount === "number" && Number.isFinite(session.messageCount);
  const revisionSource = lastActivityAt
    ? session.lastActivityAt
    : hasMessageCount
      ? null
      : session.updatedAt;
  return {
    // Only summaries missing both modern signals use `updatedAt` as the
    // legacy activity fallback.
    activityAt: lastActivityAt || (hasMessageCount ? 0 : parseTimestamp(session.updatedAt)),
    activityRevision: parseSubmillisecondRevision(revisionSource),
    messageCount: normalizeMessageCount(session.messageCount),
    hasMessageCount,
  };
};

export const isSessionUnread = (
  session: SessionActivity,
  marker: SessionReadMarker | undefined,
  isVisible: boolean,
  initialized = true,
  feedResetThrough = 0,
  pendingFeedReset = false,
): boolean => {
  if (!initialized || isVisible) return false;

  if (
    pendingFeedReset ||
    (marker?.dirtyContentThrough ?? 0) > (marker?.readContentThrough ?? 0) ||
    feedResetThrough > (marker?.readResetThrough ?? 0)
  ) {
    return true;
  }

  const activity = getSessionActivityMarker(session);
  if (activity.hasMessageCount) {
    // Metadata edits can advance Bamboo's lastActivityAt without adding a
    // message. Modern summaries therefore become unread only on count growth;
    // a newly discovered empty/recovery session remains read.
    if (!marker?.hasMessageCount) return activity.messageCount > 0;
    // A lower revision is a stale list/tab observation. At the same or a
    // newer revision, *any* count change is content activity: this includes a
    // server-side truncation/reset and prevents a 100 -> 0 baseline from
    // hiding the next 1..99 messages.
    return (
      compareSessionActivityRevision(activity, marker) >= 0 &&
      activity.messageCount !== marker.messageCount
    );
  }

  // Truly legacy summaries have no messageCount, so timestamp is the only
  // available activity signal.
  return marker
    ? compareSessionActivityRevision(activity, marker) > 0
    : activity.activityAt > 0 || Boolean(activity.activityRevision);
};

const isReadMarker = (value: unknown): value is SessionReadMarker => {
  if (!value || typeof value !== "object") return false;
  const marker = value as Partial<SessionReadMarker>;
  return (
    typeof marker.activityAt === "number" &&
    Number.isFinite(marker.activityAt) &&
    marker.activityAt >= 0 &&
    (marker.activityRevision === undefined || typeof marker.activityRevision === "string") &&
    typeof marker.messageCount === "number" &&
    Number.isFinite(marker.messageCount) &&
    marker.messageCount >= 0 &&
    typeof marker.hasMessageCount === "boolean" &&
    (marker.dirtyContentThrough === undefined || isSafeCoordinate(marker.dirtyContentThrough)) &&
    (marker.readContentThrough === undefined || isSafeCoordinate(marker.readContentThrough)) &&
    (marker.readResetThrough === undefined || isSafeCoordinate(marker.readResetThrough))
  );
};

const normalizeReadMarker = (marker: SessionReadMarker): SessionReadMarker => {
  return {
    activityAt: Math.floor(marker.activityAt),
    activityRevision: marker.activityRevision ?? "",
    messageCount: Math.floor(marker.messageCount),
    hasMessageCount: marker.hasMessageCount,
    ...(marker.dirtyContentThrough !== undefined
      ? { dirtyContentThrough: marker.dirtyContentThrough }
      : {}),
    ...(marker.readContentThrough !== undefined
      ? { readContentThrough: marker.readContentThrough }
      : {}),
    ...(marker.readResetThrough !== undefined ? { readResetThrough: marker.readResetThrough } : {}),
  };
};

/** Parse the legacy v1 blob used by the pre-review implementation. */
export const parseSessionReadState = (raw: string | null): PersistedSessionReadState | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedSessionReadState>;
    if (parsed.v !== 1 || typeof parsed.initialized !== "boolean") return null;

    const markers: Record<string, SessionReadMarker> = {};
    if (parsed.markers && typeof parsed.markers === "object") {
      for (const [sessionId, marker] of Object.entries(parsed.markers)) {
        if (sessionId.trim() && isReadMarker(marker)) {
          markers[sessionId] = normalizeReadMarker(marker);
        }
      }
    }
    return { v: 1, initialized: parsed.initialized, markers };
  } catch {
    return null;
  }
};

export const parseSessionReadMarkerEntry = (
  raw: string | null,
): PersistedSessionReadMarkerEntry | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedSessionReadMarkerEntry>;
    if (parsed.v !== 2 || typeof parsed.sessionId !== "string" || !parsed.sessionId.trim()) {
      return null;
    }
    if (!isReadMarker(parsed.marker)) return null;
    return { v: 2, sessionId: parsed.sessionId, marker: normalizeReadMarker(parsed.marker) };
  } catch {
    return null;
  }
};

/**
 * Compare two observations of one session. Backend revision time is primary;
 * at an equal revision a modern count-bearing summary wins, then the larger
 * count wins. This permits 100 -> 0 after a newer truncation revision while a
 * stale tab carrying the older 100 snapshot can no longer restore it.
 */
const compareSessionActivityRevision = (
  left: SessionReadMarker,
  right: SessionReadMarker,
): number => {
  if (left.activityAt !== right.activityAt) return left.activityAt > right.activityAt ? 1 : -1;
  if (left.activityRevision !== right.activityRevision) {
    return left.activityRevision > right.activityRevision ? 1 : -1;
  }
  return 0;
};

export const compareSessionReadMarkers = (
  left: SessionReadMarker,
  right: SessionReadMarker,
): number => {
  const revisionComparison = compareSessionActivityRevision(left, right);
  if (revisionComparison !== 0) return revisionComparison;
  if (left.hasMessageCount !== right.hasMessageCount) return left.hasMessageCount ? 1 : -1;
  if (left.messageCount !== right.messageCount)
    return left.messageCount > right.messageCount ? 1 : -1;
  return 0;
};

const withUnreadComponents = (
  content: SessionReadMarker,
  dirtyContentThrough: number | undefined,
  readContentThrough: number | undefined,
  readResetThrough: number | undefined,
): SessionReadMarker => ({
  activityAt: content.activityAt,
  activityRevision: content.activityRevision,
  messageCount: content.messageCount,
  hasMessageCount: content.hasMessageCount,
  ...(dirtyContentThrough !== undefined ? { dirtyContentThrough } : {}),
  ...(readContentThrough !== undefined ? { readContentThrough } : {}),
  ...(readResetThrough !== undefined ? { readResetThrough } : {}),
});

const mergeSessionReadMarker = (
  current: SessionReadMarker,
  incoming: SessionReadMarker,
): SessionReadMarker => {
  const content = compareSessionReadMarkers(incoming, current) > 0 ? incoming : current;
  const dirtyContentThrough = Math.max(
    current.dirtyContentThrough ?? 0,
    incoming.dirtyContentThrough ?? 0,
  );
  const readContentThrough = Math.max(
    current.readContentThrough ?? 0,
    incoming.readContentThrough ?? 0,
  );
  const readResetThrough = Math.max(current.readResetThrough ?? 0, incoming.readResetThrough ?? 0);
  if (
    content === current &&
    dirtyContentThrough === (current.dirtyContentThrough ?? 0) &&
    readContentThrough === (current.readContentThrough ?? 0) &&
    readResetThrough === (current.readResetThrough ?? 0)
  ) {
    return current;
  }
  if (
    content === incoming &&
    dirtyContentThrough === (incoming.dirtyContentThrough ?? 0) &&
    readContentThrough === (incoming.readContentThrough ?? 0) &&
    readResetThrough === (incoming.readResetThrough ?? 0)
  ) {
    return incoming;
  }
  return withUnreadComponents(
    content,
    dirtyContentThrough || undefined,
    readContentThrough || undefined,
    readResetThrough || undefined,
  );
};

const sameSessionReadMarker = (left: SessionReadMarker, right: SessionReadMarker): boolean =>
  compareSessionReadMarkers(left, right) === 0 &&
  (left.dirtyContentThrough ?? 0) === (right.dirtyContentThrough ?? 0) &&
  (left.readContentThrough ?? 0) === (right.readContentThrough ?? 0) &&
  (left.readResetThrough ?? 0) === (right.readResetThrough ?? 0);

const sessionReadMarkerDominates = (
  candidate: SessionReadMarker,
  target: SessionReadMarker,
): boolean =>
  compareSessionReadMarkers(candidate, target) >= 0 &&
  (candidate.dirtyContentThrough ?? 0) >= (target.dirtyContentThrough ?? 0) &&
  (candidate.readContentThrough ?? 0) >= (target.readContentThrough ?? 0) &&
  (candidate.readResetThrough ?? 0) >= (target.readResetThrough ?? 0);

export const mergeSessionReadMarkers = (
  current: Readonly<Record<string, SessionReadMarker>>,
  incoming: Readonly<Record<string, SessionReadMarker>>,
): Record<string, SessionReadMarker> => {
  let merged = current as Record<string, SessionReadMarker>;
  let changed = false;
  for (const [sessionId, marker] of Object.entries(incoming)) {
    const previous = merged[sessionId];
    const next = previous ? mergeSessionReadMarker(previous, marker) : marker;
    if (!previous || next !== previous) {
      if (!changed) {
        merged = { ...current };
        changed = true;
      }
      merged[sessionId] = next;
    }
  }
  return merged;
};

const getLocalStorage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

const listStorageKeys = (storage: Storage): string[] => {
  try {
    return Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
      (key): key is string => Boolean(key),
    );
  } catch {
    return [];
  }
};

type StoredMarkerEntry = PersistedSessionReadMarkerEntry & { storageKey: string };

const readMarkerEntries = (storage: Storage, sessionId?: string): StoredMarkerEntry[] => {
  const entries: StoredMarkerEntry[] = [];
  for (const storageKey of listStorageKeys(storage)) {
    if (!storageKey.startsWith(SESSION_READ_STATE_MARKER_STORAGE_PREFIX)) continue;
    try {
      const entry = parseSessionReadMarkerEntry(storage.getItem(storageKey));
      if (entry && (!sessionId || entry.sessionId === sessionId)) {
        entries.push({ ...entry, storageKey });
      }
    } catch {
      // One inaccessible or malformed entry must not disable in-memory state.
    }
  }
  return entries;
};

const writerId = (() => {
  try {
    return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  } catch {
    return Math.random().toString(36).slice(2);
  }
})();
let markerSequence = 0;

const nextMarkerStorageKey = (sessionId: string): string => {
  markerSequence += 1;
  return `${SESSION_READ_STATE_MARKER_STORAGE_PREFIX}${encodeURIComponent(sessionId)}.${writerId}.${Date.now().toString(36)}.${markerSequence.toString(36)}`;
};

const nextResetStorageKey = (prefix: string): string => {
  markerSequence += 1;
  return `${prefix}${writerId}.${Date.now().toString(36)}.${markerSequence.toString(36)}`;
};

const readMaxResetThrough = (storage: Storage): number => {
  let max = 0;
  for (const key of listStorageKeys(storage)) {
    if (!key.startsWith(SESSION_READ_STATE_RESET_STORAGE_PREFIX)) continue;
    try {
      const value = Number.parseInt(storage.getItem(key) ?? "", 10);
      if (isSafeCoordinate(value)) max = Math.max(max, value);
    } catch {
      // One inaccessible entry must not hide the other durable reset entries.
    }
  }
  return max;
};

const readPendingResetTokens = (storage: Storage): string[] =>
  listStorageKeys(storage).filter((key) =>
    key.startsWith(SESSION_READ_STATE_PENDING_RESET_STORAGE_PREFIX),
  );

const readResetEntries = (storage: Storage): Array<{ key: string; through: number }> => {
  const entries: Array<{ key: string; through: number }> = [];
  for (const key of listStorageKeys(storage)) {
    if (!key.startsWith(SESSION_READ_STATE_RESET_STORAGE_PREFIX)) continue;
    try {
      const through = Number.parseInt(storage.getItem(key) ?? "", 10);
      if (isSafeCoordinate(through)) entries.push({ key, through });
    } catch {
      // One inaccessible entry must not hide the other durable reset entries.
    }
  }
  return entries;
};

const appendResetThrough = (storage: Storage, through: number): boolean => {
  const key = nextResetStorageKey(SESSION_READ_STATE_RESET_STORAGE_PREFIX);
  try {
    storage.setItem(key, String(through));
  } catch {
    return false;
  }
  const entries = readResetEntries(storage);
  const maxThrough = entries.reduce((max, entry) => Math.max(max, entry.through), 0);
  if (maxThrough < through) return false;
  const canonical = entries
    .filter((entry) => entry.through === maxThrough)
    .reduce<
      string | null
    >((winner, entry) => (!winner || entry.key > winner ? entry.key : winner), null);
  if (!canonical) return false;
  for (const other of entries) {
    if (other.key === canonical || other.through > maxThrough) continue;
    try {
      storage.removeItem(other.key);
    } catch {
      // Dominated duplicates are harmless.
    }
  }
  return readMaxResetThrough(storage) >= through;
};

/**
 * Append a uniquely-keyed observation, then best-effort compact only entries
 * for this same session. Cross-session writers never share a read-modify-write
 * key, so concurrent tabs cannot erase one another's progress.
 */
type PersistMarkerResult = {
  marker: SessionReadMarker;
  durable: boolean;
};

const persistMarkerEntry = (sessionId: string, marker: SessionReadMarker): PersistMarkerResult => {
  const storage = getLocalStorage();
  if (!storage) return { marker, durable: false };

  const storageKey = nextMarkerStorageKey(sessionId);
  try {
    const entry: PersistedSessionReadMarkerEntry = { v: 2, sessionId, marker };
    storage.setItem(storageKey, JSON.stringify(entry));
  } catch {
    // Keep the observation in memory even when persistence is unavailable.
  }

  let entries = readMarkerEntries(storage, sessionId);
  const syntheticEntry: StoredMarkerEntry = { v: 2, sessionId, marker, storageKey };
  const storedWrite = entries.some((entry) => entry.storageKey === storageKey);
  let aggregate = (storedWrite ? entries : [...entries, syntheticEntry]).reduce(
    (merged, entry) => (merged ? mergeSessionReadMarker(merged, entry.marker) : entry.marker),
    undefined as SessionReadMarker | undefined,
  );

  // If this write did not already contain all components observed from other
  // tabs, append the merged CRDT value before removing any source entry.
  if (storedWrite && aggregate && !sameSessionReadMarker(marker, aggregate)) {
    const canonicalKey = nextMarkerStorageKey(sessionId);
    try {
      storage.setItem(
        canonicalKey,
        JSON.stringify({
          v: 2,
          sessionId,
          marker: aggregate,
        } satisfies PersistedSessionReadMarkerEntry),
      );
    } catch {
      // Retain every source entry: their component-wise merge is still safe.
    }
  }

  // Re-read immediately before compaction. Another tab may have appended a
  // component after our first scan; never remove an entry that was not part of
  // the dominance proof below. Equivalent aggregate writers also choose the
  // same lexicographically-greatest key, preventing two tabs from each keeping
  // their own key while deleting the other's.
  entries = readMarkerEntries(storage, sessionId);
  aggregate = entries.reduce(
    (merged, entry) => (merged ? mergeSessionReadMarker(merged, entry.marker) : entry.marker),
    aggregate,
  );
  const canonicalStored = aggregate
    ? entries.reduce<StoredMarkerEntry | undefined>((canonical, entry) => {
        if (!sameSessionReadMarker(entry.marker, aggregate)) return canonical;
        return !canonical || entry.storageKey > canonical.storageKey ? entry : canonical;
      }, undefined)
    : undefined;
  if (
    canonicalStored &&
    entries.every((entry) => sessionReadMarkerDominates(canonicalStored.marker, entry.marker))
  ) {
    for (const entry of entries) {
      if (entry.storageKey === canonicalStored.storageKey) continue;
      try {
        storage.removeItem(entry.storageKey);
      } catch {
        // Duplicate dominated entries are harmless and can be retried later.
      }
    }
  }

  const durableEntries = readMarkerEntries(storage, sessionId);
  const durableAggregate = durableEntries.reduce(
    (merged, entry) => (merged ? mergeSessionReadMarker(merged, entry.marker) : entry.marker),
    aggregate,
  );
  return {
    marker: durableAggregate ?? aggregate ?? marker,
    // A successful `setItem` is not enough if enumerating storage cannot see
    // the entry. Keep initialization/migration flags unset until a durable
    // winner can be verified, otherwise a partial quota failure can make
    // historical sessions appear unread after reload.
    durable: Boolean(
      durableAggregate &&
        durableEntries.some((entry) => sessionReadMarkerDominates(entry.marker, durableAggregate)),
    ),
  };
};

const setMonotonicFlag = (storage: Storage, key: string): boolean => {
  try {
    // Key presence is the flag. It is only ever written, never reset, so two
    // tabs cannot regress it through a shared read-modify-write snapshot.
    storage.setItem(key, "1");
    return true;
  } catch {
    return false;
  }
};

const hasMonotonicFlag = (storage: Storage, key: string): boolean => {
  try {
    return storage.getItem(key) === "1";
  } catch {
    return false;
  }
};

const readDurableMarkers = (storage: Storage): Record<string, SessionReadMarker> => {
  let markers: Record<string, SessionReadMarker> = {};
  for (const entry of readMarkerEntries(storage)) {
    markers = mergeSessionReadMarkers(markers, { [entry.sessionId]: entry.marker });
  }
  return markers;
};

const areSessionMarkersDurable = (
  storage: Storage,
  sessions: ReadonlyArray<SessionActivity>,
  markers: Readonly<Record<string, SessionReadMarker>>,
): boolean => {
  const durableMarkers = readDurableMarkers(storage);
  return sessions.every((session) => {
    if (!session.id.trim()) return true;
    const target = markers[session.id] ?? getSessionActivityMarker(session);
    const durable = durableMarkers[session.id];
    return Boolean(durable && sessionReadMarkerDominates(durable, target));
  });
};

const readPersistedState = (): {
  initialized: boolean;
  markers: Record<string, SessionReadMarker>;
  feedResetThrough: number;
  pendingFeedReset: boolean;
} => {
  const storage = getLocalStorage();
  if (!storage) return EMPTY_PERSISTED_STATE;

  let markers = readDurableMarkers(storage);

  let initialized = hasMonotonicFlag(storage, SESSION_READ_STATE_META_STORAGE_KEY);
  if (!hasMonotonicFlag(storage, SESSION_READ_STATE_MIGRATION_STORAGE_KEY)) {
    let legacy: PersistedSessionReadState | null = null;
    let legacyReadSucceeded = true;
    try {
      legacy = parseSessionReadState(storage.getItem(SESSION_READ_STATE_STORAGE_KEY));
    } catch {
      // A disabled legacy key does not block v2 state.
      legacyReadSucceeded = false;
    }

    let migrationComplete = legacyReadSucceeded;
    if (legacy) {
      initialized ||= legacy.initialized;
      for (const [sessionId, marker] of Object.entries(legacy.markers)) {
        const persisted = persistMarkerEntry(sessionId, marker);
        markers = mergeSessionReadMarkers(markers, { [sessionId]: persisted.marker });
      }
      migrationComplete = areSessionMarkersDurable(
        storage,
        Object.entries(legacy.markers).map(([id, marker]) => ({
          id,
          lastActivityAt: new Date(marker.activityAt).toISOString(),
          messageCount: marker.hasMessageCount ? marker.messageCount : undefined,
        })),
        markers,
      );
      if (legacy.initialized) {
        migrationComplete =
          migrationComplete && setMonotonicFlag(storage, SESSION_READ_STATE_META_STORAGE_KEY);
      }
    }
    if (migrationComplete) {
      setMonotonicFlag(storage, SESSION_READ_STATE_MIGRATION_STORAGE_KEY);
    }
  }

  return {
    initialized,
    markers,
    feedResetThrough: readMaxResetThrough(storage),
    pendingFeedReset: readPendingResetTokens(storage).length > 0,
  };
};

const persistObservedSessions = (
  current: Readonly<Record<string, SessionReadMarker>>,
  sessions: ReadonlyArray<SessionActivity>,
  feedResetThrough: number,
  acknowledgeDirty:
    | boolean
    | Readonly<
        Record<
          string,
          | {
              content?: number;
              reset?: number;
            }
          | undefined
        >
      > = false,
): Record<string, SessionReadMarker> => {
  let markers = current as Record<string, SessionReadMarker>;
  for (const session of sessions) {
    if (!session.id.trim()) continue;
    const observed = getSessionActivityMarker(session);
    const previous = markers[session.id];
    // Bamboo currently advances lastActivityAt for metadata-only edits. Do
    // not move a modern read marker when the message count is unchanged: in
    // addition to avoiding pointless writes, this preserves the older content
    // revision so a later authoritative count reset can supersede it.
    const preservePreviousContent =
      previous?.hasMessageCount &&
      observed.hasMessageCount &&
      observed.messageCount === previous.messageCount;
    const content =
      previous && (preservePreviousContent || compareSessionReadMarkers(observed, previous) <= 0)
        ? previous
        : observed;
    let target = previous ? mergeSessionReadMarker(previous, content) : content;
    const dirtyToAcknowledge =
      acknowledgeDirty === true
        ? { content: target.dirtyContentThrough, reset: feedResetThrough }
        : acknowledgeDirty
          ? acknowledgeDirty[session.id]
          : undefined;
    if (dirtyToAcknowledge?.content || dirtyToAcknowledge?.reset) {
      target = withUnreadComponents(
        target,
        target.dirtyContentThrough,
        Math.max(target.readContentThrough ?? 0, dirtyToAcknowledge.content ?? 0) || undefined,
        Math.max(target.readResetThrough ?? 0, dirtyToAcknowledge.reset ?? 0) || undefined,
      );
    }
    if (previous && sameSessionReadMarker(previous, target)) continue;
    const persisted = persistMarkerEntry(session.id, target);
    markers = mergeSessionReadMarkers(markers, { [session.id]: persisted.marker });
  }
  return markers;
};

const initialState = readPersistedState();

const pendingResetMemoryTokens = new Set<string>();

export const useSessionReadStateStore = create<SessionReadState>((set, get) => ({
  v: 2,
  ...initialState,

  initialize: (sessions) => {
    if (sessions.length === 0) return;
    // The store module can be imported well before the sidebar subscribes to
    // storage events. Always hydrate first so a write from another tab in
    // that window cannot be overwritten by bootstrap baselining.
    const persisted = readPersistedState();
    const current = get();
    const initialized = current.initialized || persisted.initialized;
    const hydratedMarkers = mergeSessionReadMarkers(current.markers, persisted.markers);
    const feedResetThrough = Math.max(current.feedResetThrough, persisted.feedResetThrough);
    // Storage-backed pending tokens are a live set, not a monotonic clock.
    // Another tab may resolve and delete the final token, so a fresh durable
    // read must be allowed to clear this tab's stale in-memory `true`. Only a
    // token that could not be persisted remains owned by this process.
    const pendingFeedReset = current.pendingFeedReset || persisted.pendingFeedReset;
    if (initialized) {
      if (
        !current.initialized ||
        hydratedMarkers !== current.markers ||
        feedResetThrough !== current.feedResetThrough ||
        pendingFeedReset !== current.pendingFeedReset
      ) {
        set({
          initialized: true,
          markers: hydratedMarkers,
          feedResetThrough,
          pendingFeedReset,
        });
      }
      return;
    }
    // Persist all baselines first; only then publish the monotonic initialized
    // bit so a partial/quota failure cannot make historical rows unread on the
    // next successful load.
    // A pending/reset gap is live activity, not historical bootstrap data. Do
    // not acknowledge it merely because the first list arrived.
    const markers = persistObservedSessions(
      hydratedMarkers,
      sessions,
      feedResetThrough,
      feedResetThrough === 0,
    );
    const storage = getLocalStorage();
    if (storage && areSessionMarkersDurable(storage, sessions, markers)) {
      setMonotonicFlag(storage, SESSION_READ_STATE_META_STORAGE_KEY);
      setMonotonicFlag(storage, SESSION_READ_STATE_MIGRATION_STORAGE_KEY);
    }
    set({ initialized: true, markers, feedResetThrough, pendingFeedReset });
  },

  markRead: (sessions, explicitlyObserved) => {
    if (!sessions.length) return;
    // Reconcile a possibly missed cross-tab event before deciding an observed
    // snapshot is unchanged. A stale in-memory marker must never win merely
    // because the sidebar listener has not mounted yet.
    const persisted = readPersistedState();
    const current = get();
    const observedDirty =
      explicitlyObserved ??
      Object.fromEntries(
        sessions.map((session) => {
          const marker = current.markers[session.id];
          return [
            session.id,
            marker
              ? {
                  content: marker.dirtyContentThrough,
                  reset: current.feedResetThrough,
                }
              : undefined,
          ];
        }),
      );
    const initialized = current.initialized || persisted.initialized;
    const hydratedMarkers = mergeSessionReadMarkers(current.markers, persisted.markers);
    const feedResetThrough = Math.max(current.feedResetThrough, persisted.feedResetThrough);
    const pendingFeedReset = current.pendingFeedReset || persisted.pendingFeedReset;
    const markers = persistObservedSessions(
      hydratedMarkers,
      sessions,
      feedResetThrough,
      observedDirty,
    );
    if (
      initialized !== current.initialized ||
      markers !== current.markers ||
      feedResetThrough !== current.feedResetThrough ||
      pendingFeedReset !== current.pendingFeedReset
    ) {
      set({ initialized, markers, feedResetThrough, pendingFeedReset });
    }
  },

  markUnreadFromFeed: (sessionId, feedSeq) => {
    if (!sessionId.trim() || !isSafeCoordinate(feedSeq) || feedSeq === 0) return false;
    const persisted = readPersistedState();
    const current = get();
    const hydratedMarkers = mergeSessionReadMarkers(current.markers, persisted.markers);
    const previous = hydratedMarkers[sessionId] ?? {
      activityAt: 0,
      activityRevision: "",
      messageCount: 0,
      hasMessageCount: false,
    };
    if ((previous.dirtyContentThrough ?? 0) >= feedSeq) {
      if (hydratedMarkers !== current.markers) set({ markers: hydratedMarkers });
      const storage = getLocalStorage();
      if (!storage) return false;
      const durable = readDurableMarkers(storage)[sessionId];
      return Boolean(durable && (durable.dirtyContentThrough ?? 0) >= feedSeq);
    }
    const target = withUnreadComponents(
      previous,
      feedSeq,
      previous.readContentThrough,
      previous.readResetThrough,
    );
    const saved = persistMarkerEntry(sessionId, target);
    set({
      initialized: current.initialized || persisted.initialized,
      markers: mergeSessionReadMarkers(hydratedMarkers, { [sessionId]: saved.marker }),
      feedResetThrough: Math.max(current.feedResetThrough, persisted.feedResetThrough),
      pendingFeedReset: current.pendingFeedReset || persisted.pendingFeedReset,
    });
    return saved.durable && (saved.marker.dirtyContentThrough ?? 0) >= feedSeq;
  },

  beginFeedReset: () => {
    const storage = getLocalStorage();
    const token = nextResetStorageKey(SESSION_READ_STATE_PENDING_RESET_STORAGE_PREFIX);
    if (!storage) {
      pendingResetMemoryTokens.add(token);
      set({ pendingFeedReset: true });
      return { token, durable: false };
    }
    try {
      storage.setItem(token, "1");
      const durable = storage.getItem(token) === "1";
      if (!durable) pendingResetMemoryTokens.add(token);
      set({ pendingFeedReset: true });
      return { token, durable };
    } catch {
      pendingResetMemoryTokens.add(token);
      set({ pendingFeedReset: true });
      return { token, durable: false };
    }
  },

  pendingFeedResetTokens: () => {
    const storage = getLocalStorage();
    return [...pendingResetMemoryTokens, ...(storage ? readPendingResetTokens(storage) : [])];
  },

  resolveFeedResets: (tokens, feedHead) => {
    if (!tokens.length || !isSafeCoordinate(feedHead)) return true;
    const storage = getLocalStorage();
    if (!storage || !appendResetThrough(storage, feedHead)) return false;
    for (const token of tokens) {
      if (!token.startsWith(SESSION_READ_STATE_PENDING_RESET_STORAGE_PREFIX)) continue;
      try {
        storage.removeItem(token);
        pendingResetMemoryTokens.delete(token);
      } catch {
        return false;
      }
    }
    const persisted = readPersistedState();
    set((current) => ({
      feedResetThrough: Math.max(current.feedResetThrough, persisted.feedResetThrough, feedHead),
      markers: mergeSessionReadMarkers(current.markers, persisted.markers),
      initialized: current.initialized || persisted.initialized,
      pendingFeedReset:
        pendingResetMemoryTokens.size > 0 || readPendingResetTokens(storage).length > 0,
    }));
    return tokens.every((token) => {
      try {
        return storage.getItem(token) === null;
      } catch {
        return false;
      }
    });
  },

  applyPersistedState: (incoming) => {
    set((current) => {
      const initialized = current.initialized || incoming.initialized;
      const markers = mergeSessionReadMarkers(current.markers, incoming.markers);
      const feedResetThrough = Math.max(current.feedResetThrough, incoming.feedResetThrough);
      // Unlike the three monotonic components above, pending reset tokens can
      // be removed by the tab that finishes hydration. Let the storage event
      // clear a stale flag once no process-local fallback token remains.
      const pendingFeedReset = pendingResetMemoryTokens.size > 0 || incoming.pendingFeedReset;
      return initialized !== current.initialized ||
        markers !== current.markers ||
        feedResetThrough !== current.feedResetThrough ||
        pendingFeedReset !== current.pendingFeedReset
        ? { initialized, markers, feedResetThrough, pendingFeedReset }
        : current;
    });
  },
}));

const syncSessionReadStateFromStorage = (): void => {
  useSessionReadStateStore.getState().applyPersistedState(readPersistedState());
};

/** Install cross-tab synchronization. Returns a no-op outside a browser. */
export const subscribeToSessionReadStorage = (): (() => void) => {
  if (typeof window === "undefined") return () => undefined;

  // Re-read synchronously before subscribing. This closes the import -> first
  // sidebar mount window in which another tab may already have advanced state.
  syncSessionReadStateFromStorage();
  const listener = (event: StorageEvent) => {
    if (
      event.key !== SESSION_READ_STATE_META_STORAGE_KEY &&
      event.key !== SESSION_READ_STATE_MIGRATION_STORAGE_KEY &&
      event.key !== SESSION_READ_STATE_STORAGE_KEY &&
      !event.key?.startsWith(SESSION_READ_STATE_MARKER_STORAGE_PREFIX) &&
      !event.key?.startsWith(SESSION_READ_STATE_RESET_STORAGE_PREFIX) &&
      !event.key?.startsWith(SESSION_READ_STATE_PENDING_RESET_STORAGE_PREFIX)
    ) {
      return;
    }
    syncSessionReadStateFromStorage();
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
};
