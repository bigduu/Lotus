import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SESSION_READ_STATE_MARKER_STORAGE_PREFIX,
  SESSION_READ_STATE_META_STORAGE_KEY,
  SESSION_READ_STATE_MIGRATION_STORAGE_KEY,
  SESSION_READ_STATE_PENDING_RESET_STORAGE_PREFIX,
  SESSION_READ_STATE_RESET_STORAGE_PREFIX,
  SESSION_READ_STATE_STORAGE_KEY,
  compareSessionReadMarkers,
  getSessionActivityMarker,
  isSessionUnread,
  mergeSessionReadMarkers,
  parseSessionReadMarkerEntry,
  parseSessionReadState,
  subscribeToSessionReadStorage,
  useSessionReadStateStore,
  type SessionReadMarker,
} from "./sessionReadStateStore";

const session = (overrides: Record<string, unknown> = {}) => ({
  id: "session-1",
  lastActivityAt: "2026-08-14T01:00:00.000Z",
  updatedAt: "2026-08-14T02:00:00.000Z",
  messageCount: 3,
  ...overrides,
});

const marker = (overrides: Partial<SessionReadMarker> = {}): SessionReadMarker => ({
  activityAt: Date.parse("2026-08-14T01:00:00.000Z"),
  activityRevision: "000000",
  messageCount: 3,
  hasMessageCount: true,
  ...overrides,
});

const markerKeys = (): string[] =>
  Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter(
    (key): key is string => Boolean(key?.startsWith(SESSION_READ_STATE_MARKER_STORAGE_PREFIX)),
  );

const writeMarkerEntry = (storageKey: string, sessionId: string, value: SessionReadMarker) => {
  localStorage.setItem(storageKey, JSON.stringify({ v: 2, sessionId, marker: value }));
};

describe("session unread pure logic", () => {
  it("keeps lastActivityAt only as snapshot revision metadata", () => {
    expect(getSessionActivityMarker(session())).toEqual(marker());
  });

  it("uses messageCount without metadata updatedAt when the activity timestamp is absent", () => {
    expect(getSessionActivityMarker(session({ lastActivityAt: null }))).toEqual(
      marker({ activityAt: 0, activityRevision: "" }),
    );
  });

  it("falls back to updatedAt only for legacy summaries missing both activity signals", () => {
    expect(
      getSessionActivityMarker(session({ lastActivityAt: null, messageCount: undefined })),
    ).toEqual({
      activityAt: Date.parse("2026-08-14T02:00:00.000Z"),
      activityRevision: "000000",
      messageCount: 0,
      hasMessageCount: false,
    });
  });

  it("does not report unread before initialization or while visible", () => {
    expect(isSessionUnread(session(), undefined, false, false)).toBe(false);
    expect(isSessionUnread(session({ messageCount: 4 }), marker(), true)).toBe(false);
  });

  it("keeps a count-neutral ABA dirty until its generation is acknowledged", () => {
    const dirty = marker({ dirtyContentThrough: 11 });
    expect(isSessionUnread(session(), dirty, false)).toBe(true);
    expect(
      isSessionUnread(
        session(),
        marker({
          dirtyContentThrough: 11,
          readContentThrough: 11,
        }),
        false,
      ),
    ).toBe(false);
  });

  it("uses count growth only for modern summaries despite metadata timestamp changes", () => {
    expect(
      isSessionUnread(
        session({
          lastActivityAt: "2026-08-15T01:00:00.000Z",
          updatedAt: "2026-08-15T01:00:00.000Z",
          messageCount: 3,
        }),
        marker(),
        false,
      ),
    ).toBe(false);
    expect(isSessionUnread(session({ messageCount: 4 }), marker(), false)).toBe(true);
  });

  it("treats a count reset at a non-stale revision as unread", () => {
    expect(
      isSessionUnread(
        session({ lastActivityAt: "2026-08-15T00:00:00.000Z", messageCount: 0 }),
        marker({ messageCount: 100 }),
        false,
      ),
    ).toBe(true);
    expect(
      isSessionUnread(
        session({ lastActivityAt: "2026-08-13T00:00:00.000Z", messageCount: 0 }),
        marker({ messageCount: 100 }),
        false,
      ),
    ).toBe(false);
  });

  it("does not flash a markerless modern empty/recovery session unread", () => {
    expect(isSessionUnread(session({ messageCount: 0 }), undefined, false)).toBe(false);
    expect(isSessionUnread(session({ messageCount: 1 }), undefined, false)).toBe(true);
  });

  it("uses timestamp only for legacy summaries", () => {
    const legacyMarker = marker({ hasMessageCount: false, messageCount: 0 });
    expect(
      isSessionUnread(
        session({
          lastActivityAt: null,
          updatedAt: "2026-08-15T00:00:00.000Z",
          messageCount: undefined,
        }),
        legacyMarker,
        false,
      ),
    ).toBe(true);
  });

  it("preserves sub-millisecond ordering for legacy timestamp-only summaries", () => {
    const before = getSessionActivityMarker(
      session({
        lastActivityAt: "2026-08-14T01:00:00.000001Z",
        messageCount: undefined,
      }),
    );

    expect(
      isSessionUnread(
        session({
          lastActivityAt: "2026-08-14T01:00:00.000002Z",
          messageCount: undefined,
        }),
        before,
        false,
      ),
    ).toBe(true);
  });

  it("orders per-session snapshots by revision before count", () => {
    expect(
      compareSessionReadMarkers(
        marker({ activityAt: 20, messageCount: 0 }),
        marker({ activityAt: 10, messageCount: 100 }),
      ),
    ).toBeGreaterThan(0);
    expect(
      compareSessionReadMarkers(
        marker({ activityAt: 10, messageCount: 99 }),
        marker({ activityAt: 20, messageCount: 0 }),
      ),
    ).toBeLessThan(0);
  });

  it("preserves Bamboo sub-millisecond revisions for count resets", () => {
    const before = getSessionActivityMarker(
      session({ lastActivityAt: "2026-08-14T01:00:00.000001Z", messageCount: 100 }),
    );
    const after = getSessionActivityMarker(
      session({ lastActivityAt: "2026-08-14T01:00:00.000002Z", messageCount: 0 }),
    );

    expect(before.activityAt).toBe(after.activityAt);
    expect(before.activityRevision).toBe("001000");
    expect(after.activityRevision).toBe("002000");
    expect(mergeSessionReadMarkers({ s: before }, { s: after }).s).toEqual(after);
  });

  it("allows a newer truncation baseline and rejects a stale high-count snapshot", () => {
    const truncated = marker({ activityAt: 20, messageCount: 0 });
    const stale = marker({ activityAt: 10, messageCount: 100 });
    expect(mergeSessionReadMarkers({ s: stale }, { s: truncated }).s).toEqual(truncated);
    expect(mergeSessionReadMarkers({ s: truncated }, { s: stale }).s).toEqual(truncated);
  });

  it("parses valid legacy and v2 entries while rejecting malformed data", () => {
    const legacyRaw = JSON.stringify({
      v: 1,
      initialized: true,
      markers: { s: { ...marker(), readAt: 123 } },
    });
    expect(parseSessionReadState(legacyRaw)?.markers.s).toEqual(marker());
    expect(
      parseSessionReadMarkerEntry(JSON.stringify({ v: 2, sessionId: "s", marker: marker() })),
    ).toEqual({ v: 2, sessionId: "s", marker: marker() });
    expect(parseSessionReadState("{")).toBeNull();
    expect(parseSessionReadMarkerEntry("{")).toBeNull();
  });
});

describe("session read-state store", () => {
  beforeEach(() => {
    localStorage.clear();
    useSessionReadStateStore.setState({
      v: 2,
      initialized: false,
      markers: {},
      feedResetThrough: 0,
    });
    vi.restoreAllMocks();
  });

  it("does not initialize from a pre-bootstrap empty list", () => {
    useSessionReadStateStore.getState().initialize([]);
    expect(useSessionReadStateStore.getState().initialized).toBe(false);
  });

  it("baselines all historical sessions and persists per-session entries plus init meta", () => {
    useSessionReadStateStore.getState().initialize([session(), session({ id: "session-2" })]);
    expect(useSessionReadStateStore.getState().initialized).toBe(true);
    expect(Object.keys(useSessionReadStateStore.getState().markers).sort()).toEqual([
      "session-1",
      "session-2",
    ]);
    expect(markerKeys()).toHaveLength(2);
    expect(localStorage.getItem(SESSION_READ_STATE_META_STORAGE_KEY)).toBe("1");
  });

  it("markRead is idempotent and advances only the observed session", () => {
    useSessionReadStateStore.getState().initialize([session()]);
    const baseline = useSessionReadStateStore.getState().markers["session-1"];
    const persistedCount = markerKeys().length;
    useSessionReadStateStore.getState().markRead([session()]);
    expect(useSessionReadStateStore.getState().markers["session-1"]).toBe(baseline);
    expect(markerKeys()).toHaveLength(persistedCount);

    useSessionReadStateStore
      .getState()
      .markRead([session({ lastActivityAt: "2026-08-14T03:00:00.000Z", messageCount: 4 })]);
    expect(useSessionReadStateStore.getState().markers["session-1"].messageCount).toBe(4);
  });

  it("persists a feed dirty latch across 2 -> 1 -> 2 until markRead", () => {
    useSessionReadStateStore.getState().initialize([session({ messageCount: 2 })]);
    useSessionReadStateStore.getState().markUnreadFromFeed("session-1", 10);
    useSessionReadStateStore.getState().markUnreadFromFeed("session-1", 11);

    let current = useSessionReadStateStore.getState();
    expect(
      isSessionUnread(
        session({ messageCount: 2 }),
        current.markers["session-1"],
        false,
        current.initialized,
      ),
    ).toBe(true);

    useSessionReadStateStore.setState({
      v: 2,
      initialized: false,
      markers: {},
      feedResetThrough: 0,
    });
    const unsubscribe = subscribeToSessionReadStorage();
    current = useSessionReadStateStore.getState();
    expect(isSessionUnread(session({ messageCount: 2 }), current.markers["session-1"], false)).toBe(
      true,
    );
    current.markRead([session({ messageCount: 2 })]);
    current = useSessionReadStateStore.getState();
    expect(isSessionUnread(session({ messageCount: 2 }), current.markers["session-1"], false)).toBe(
      false,
    );
    unsubscribe();
  });

  it("component-wise merges bounded cross-tab dirty and read watermarks", () => {
    const base = marker({
      dirtyContentThrough: 12,
      readContentThrough: 10,
    });
    const staleContentWithNewRead = marker({
      activityAt: 1,
      messageCount: 1,
      readContentThrough: 12,
    });
    const merged = mergeSessionReadMarkers({ s: base }, { s: staleContentWithNewRead }).s;
    expect(merged).toMatchObject({
      activityAt: base.activityAt,
      messageCount: base.messageCount,
      dirtyContentThrough: 12,
      readContentThrough: 12,
    });
    expect(isSessionUnread(session(), merged, false)).toBe(false);

    const laterDirty = marker({ dirtyContentThrough: 13 });
    const afterConcurrentWrite = mergeSessionReadMarkers({ s: merged }, { s: laterDirty }).s;
    expect(isSessionUnread(session(), afterConcurrentWrite, false)).toBe(true);
  });

  it("does not let a stale tab markRead acknowledge newly hydrated dirty activity", () => {
    useSessionReadStateStore.getState().initialize([session()]);
    const staleInMemoryMarker = useSessionReadStateStore.getState().markers["session-1"];
    writeMarkerEntry(
      `${SESSION_READ_STATE_MARKER_STORAGE_PREFIX}session-1.other-tab`,
      "session-1",
      marker({ dirtyContentThrough: 20 }),
    );
    useSessionReadStateStore.setState({
      v: 2,
      initialized: true,
      feedResetThrough: 0,
      markers: { "session-1": staleInMemoryMarker },
    });

    useSessionReadStateStore.getState().markRead([session()]);
    let current = useSessionReadStateStore.getState();
    expect(isSessionUnread(session(), current.markers["session-1"], false)).toBe(true);

    // A later visible/read pass has now observed the dirty generation and may
    // persist its monotonic tombstone.
    current.markRead([session()]);
    current = useSessionReadStateStore.getState();
    expect(isSessionUnread(session(), current.markers["session-1"], false)).toBe(false);
  });

  it("persists an account-level reset for sessions discovered after startup", () => {
    useSessionReadStateStore.getState().initialize([session()]);
    const reset = useSessionReadStateStore.getState().beginFeedReset();
    expect(reset.durable).toBe(true);
    expect(useSessionReadStateStore.getState().resolveFeedResets([reset.token], 20)).toBe(true);
    expect(useSessionReadStateStore.getState().feedResetThrough).toBe(20);
    expect(
      isSessionUnread(
        session(),
        useSessionReadStateStore.getState().markers["session-1"],
        false,
        true,
        20,
      ),
    ).toBe(true);
    useSessionReadStateStore.getState().markRead([session()]);
    expect(
      isSessionUnread(
        session(),
        useSessionReadStateStore.getState().markers["session-1"],
        false,
        true,
        20,
      ),
    ).toBe(false);
  });

  it("keeps reset storage bounded while advancing the global watermark", () => {
    for (const through of [10, 20, 30]) {
      const reset = useSessionReadStateStore.getState().beginFeedReset();
      expect(useSessionReadStateStore.getState().resolveFeedResets([reset.token], through)).toBe(
        true,
      );
    }
    const resetKeys = Array.from({ length: localStorage.length }, (_, index) =>
      localStorage.key(index),
    ).filter((key) => key?.startsWith(SESSION_READ_STATE_RESET_STORAGE_PREFIX));
    expect(resetKeys).toHaveLength(1);
    expect(
      Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).some(
        (key) => key?.startsWith(SESSION_READ_STATE_PENDING_RESET_STORAGE_PREFIX),
      ),
    ).toBe(false);
  });

  it("clears a stale pending-reset flag when another tab removes the final token", () => {
    const unsubscribe = subscribeToSessionReadStorage();
    const token = `${SESSION_READ_STATE_PENDING_RESET_STORAGE_PREFIX}other-tab`;
    localStorage.setItem(token, "1");
    window.dispatchEvent(new StorageEvent("storage", { key: token, newValue: "1" }));
    expect(useSessionReadStateStore.getState().pendingFeedReset).toBe(true);

    localStorage.removeItem(token);
    window.dispatchEvent(new StorageEvent("storage", { key: token, oldValue: "1" }));
    expect(useSessionReadStateStore.getState().pendingFeedReset).toBe(false);
    unsubscribe();
  });

  it("deduplicates replayed server coordinates without growing marker size", () => {
    const tabA = marker({ dirtyContentThrough: 9 });
    const tabB = marker({ dirtyContentThrough: 9 });
    const merged = mergeSessionReadMarkers({ s: tabA }, { s: tabB }).s;
    expect(merged.dirtyContentThrough).toBe(9);

    const read = mergeSessionReadMarkers({ s: merged }, { s: marker({ readContentThrough: 9 }) }).s;
    expect(isSessionUnread(session(), read, false)).toBe(false);
    expect(
      isSessionUnread(session(), mergeSessionReadMarkers({ s: read }, { s: tabB }).s, false),
    ).toBe(false);
  });

  it("keeps a hot session marker bounded after thousands of feed events", () => {
    useSessionReadStateStore.getState().initialize([session()]);
    for (let seq = 1; seq <= 5_000; seq += 1) {
      expect(useSessionReadStateStore.getState().markUnreadFromFeed("session-1", seq)).toBe(true);
    }
    const current = useSessionReadStateStore.getState().markers["session-1"];
    expect(current.dirtyContentThrough).toBe(5_000);
    expect(JSON.stringify(current).length).toBeLessThan(300);
    expect(markerKeys()).toHaveLength(1);
  });

  it("does not let a stale tab acknowledge a newly hydrated feed coordinate", () => {
    useSessionReadStateStore.getState().initialize([session()]);
    const stale = useSessionReadStateStore.getState().markers["session-1"];
    writeMarkerEntry(
      `${SESSION_READ_STATE_MARKER_STORAGE_PREFIX}session-1.other-tab-new`,
      "session-1",
      marker({ dirtyContentThrough: 101 }),
    );
    useSessionReadStateStore.setState({
      v: 2,
      initialized: true,
      feedResetThrough: 0,
      markers: { "session-1": stale },
    });

    useSessionReadStateStore.getState().markRead([session()]);
    const after = useSessionReadStateStore.getState().markers["session-1"];
    expect(after.dirtyContentThrough).toBe(101);
    expect(after.readContentThrough ?? 0).toBeLessThan(101);
  });

  it("does not advance a modern marker for a metadata-only timestamp bump", () => {
    useSessionReadStateStore.getState().initialize([session()]);
    const baseline = useSessionReadStateStore.getState().markers["session-1"];

    useSessionReadStateStore.getState().markRead([
      session({
        lastActivityAt: "2026-08-15T00:00:00.000Z",
        updatedAt: "2026-08-15T00:00:00.000Z",
      }),
    ]);

    expect(useSessionReadStateStore.getState().markers["session-1"]).toBe(baseline);
  });

  it("accepts a lower count at the next content revision after a metadata-only bump", () => {
    useSessionReadStateStore
      .getState()
      .initialize([session({ lastActivityAt: "2026-08-14T01:00:00.000Z", messageCount: 100 })]);

    useSessionReadStateStore
      .getState()
      .markRead([session({ lastActivityAt: "2026-08-15T00:00:00.000Z", messageCount: 100 })]);
    useSessionReadStateStore
      .getState()
      .markRead([session({ lastActivityAt: "2026-08-15T00:00:00.000Z", messageCount: 1 })]);

    expect(useSessionReadStateStore.getState().markers["session-1"]).toMatchObject({
      activityAt: Date.parse("2026-08-15T00:00:00.000Z"),
      messageCount: 1,
    });
  });

  it("does not lose another tab's session because writers use unique per-session keys", () => {
    const otherKey = `${SESSION_READ_STATE_MARKER_STORAGE_PREFIX}session-2.other`;
    writeMarkerEntry(otherKey, "session-2", marker({ activityAt: 20, messageCount: 8 }));
    useSessionReadStateStore.setState({
      v: 2,
      initialized: true,
      feedResetThrough: 0,
      markers: { "session-1": marker({ activityAt: 10 }) },
    });

    useSessionReadStateStore
      .getState()
      .markRead([session({ lastActivityAt: "2026-08-14T04:00:00.000Z", messageCount: 4 })]);
    const persistedSessionIds = markerKeys()
      .map((key) => parseSessionReadMarkerEntry(localStorage.getItem(key))?.sessionId)
      .filter(Boolean);
    expect(persistedSessionIds.sort()).toEqual(["session-1", "session-2"]);

    const unsubscribe = subscribeToSessionReadStorage();
    expect(Object.keys(useSessionReadStateStore.getState().markers).sort()).toEqual([
      "session-1",
      "session-2",
    ]);
    unsubscribe();
  });

  it("compacts a stale same-session entry without letting it regress a newer truncation", () => {
    writeMarkerEntry(
      `${SESSION_READ_STATE_MARKER_STORAGE_PREFIX}session-1.new`,
      "session-1",
      marker({ activityAt: 20, messageCount: 0 }),
    );
    useSessionReadStateStore.setState({
      v: 2,
      initialized: true,
      feedResetThrough: 0,
      markers: { "session-1": marker({ activityAt: 10, messageCount: 100 }) },
    });

    useSessionReadStateStore
      .getState()
      .markRead([session({ lastActivityAt: new Date(10).toISOString(), messageCount: 100 })]);
    const unsubscribe = subscribeToSessionReadStorage();
    expect(useSessionReadStateStore.getState().markers["session-1"]).toEqual(
      marker({ activityAt: 20, messageCount: 0 }),
    );
    unsubscribe();
  });

  it("migrates a legacy blob exactly once into v2 entries", () => {
    localStorage.setItem(
      SESSION_READ_STATE_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        initialized: true,
        markers: { legacy: { ...marker({ activityAt: 30 }), readAt: 99 } },
      }),
    );
    const unsubscribe = subscribeToSessionReadStorage();
    expect(useSessionReadStateStore.getState().markers.legacy).toEqual(marker({ activityAt: 30 }));
    expect(localStorage.getItem(SESSION_READ_STATE_META_STORAGE_KEY)).toBe("1");
    expect(localStorage.getItem(SESSION_READ_STATE_MIGRATION_STORAGE_KEY)).toBe("1");
    expect(markerKeys()).toHaveLength(1);
    unsubscribe();
  });

  it("synchronously catches storage progress written before subscription", () => {
    const key = `${SESSION_READ_STATE_MARKER_STORAGE_PREFIX}late.other`;
    writeMarkerEntry(key, "late", marker({ activityAt: 40, messageCount: 9 }));
    expect(useSessionReadStateStore.getState().markers.late).toBeUndefined();
    const unsubscribe = subscribeToSessionReadStorage();
    expect(useSessionReadStateStore.getState().markers.late?.messageCount).toBe(9);
    unsubscribe();
  });

  it("hydrates persisted initialization before bootstrap can baseline stale history", () => {
    localStorage.setItem(SESSION_READ_STATE_META_STORAGE_KEY, "1");
    writeMarkerEntry(
      `${SESSION_READ_STATE_MARKER_STORAGE_PREFIX}session-1.other`,
      "session-1",
      marker({ activityAt: Date.parse("2026-08-15T00:00:00.000Z"), messageCount: 9 }),
    );

    useSessionReadStateStore.getState().initialize([session({ messageCount: 3 })]);

    expect(useSessionReadStateStore.getState().initialized).toBe(true);
    expect(useSessionReadStateStore.getState().markers["session-1"]).toEqual(
      marker({ activityAt: Date.parse("2026-08-15T00:00:00.000Z"), messageCount: 9 }),
    );
  });

  it("hydrates a newer persisted marker before markRead compares its observation", () => {
    const newerActivityAt = Date.parse("2026-08-15T00:00:00.000Z");
    writeMarkerEntry(
      `${SESSION_READ_STATE_MARKER_STORAGE_PREFIX}session-1.other`,
      "session-1",
      marker({ activityAt: newerActivityAt, messageCount: 9 }),
    );
    useSessionReadStateStore.setState({
      v: 2,
      initialized: true,
      feedResetThrough: 0,
      markers: { "session-1": marker({ activityAt: 10, messageCount: 3 }) },
    });

    useSessionReadStateStore.getState().markRead([session({ messageCount: 3 })]);

    expect(useSessionReadStateStore.getState().markers["session-1"]).toEqual(
      marker({ activityAt: newerActivityAt, messageCount: 9 }),
    );
  });

  it("re-reads per-session state for relevant storage events and ignores unrelated keys", () => {
    const unsubscribe = subscribeToSessionReadStorage();
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated", newValue: "1" }));
    expect(useSessionReadStateStore.getState().markers.s).toBeUndefined();

    const key = `${SESSION_READ_STATE_MARKER_STORAGE_PREFIX}s.other`;
    writeMarkerEntry(key, "s", marker({ activityAt: 50, messageCount: 7 }));
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: localStorage.getItem(key) }));
    expect(useSessionReadStateStore.getState().markers.s?.messageCount).toBe(7);
    unsubscribe();
  });

  it("keeps working in memory when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("disabled");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => useSessionReadStateStore.getState().markRead([session()])).not.toThrow();
    expect(useSessionReadStateStore.getState().markers["session-1"]).toBeDefined();
  });

  it("does not publish initialized when baseline marker persistence partially fails", () => {
    const setItem = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key.startsWith(SESSION_READ_STATE_MARKER_STORAGE_PREFIX)) {
        throw new Error("marker quota");
      }
      return setItem(key, value);
    });

    useSessionReadStateStore.getState().initialize([session()]);

    expect(useSessionReadStateStore.getState()).toMatchObject({ initialized: true });
    expect(useSessionReadStateStore.getState().markers["session-1"]).toBeDefined();
    expect(localStorage.getItem(SESSION_READ_STATE_META_STORAGE_KEY)).toBeNull();
  });

  it("retries legacy migration after a marker write fails but small flags would fit", () => {
    localStorage.setItem(
      SESSION_READ_STATE_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        initialized: true,
        markers: { legacy: marker({ activityAt: 30 }) },
      }),
    );
    const setItem = localStorage.setItem.bind(localStorage);
    const setItemSpy = vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key.startsWith(SESSION_READ_STATE_MARKER_STORAGE_PREFIX)) {
        throw new Error("marker quota");
      }
      return setItem(key, value);
    });

    const firstUnsubscribe = subscribeToSessionReadStorage();
    expect(localStorage.getItem(SESSION_READ_STATE_META_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(SESSION_READ_STATE_MIGRATION_STORAGE_KEY)).toBeNull();
    firstUnsubscribe();

    setItemSpy.mockRestore();
    useSessionReadStateStore.setState({
      v: 2,
      initialized: false,
      markers: {},
      feedResetThrough: 0,
    });
    const secondUnsubscribe = subscribeToSessionReadStorage();
    expect(useSessionReadStateStore.getState().markers.legacy).toEqual(marker({ activityAt: 30 }));
    expect(localStorage.getItem(SESSION_READ_STATE_META_STORAGE_KEY)).toBe("1");
    expect(localStorage.getItem(SESSION_READ_STATE_MIGRATION_STORAGE_KEY)).toBe("1");
    secondUnsubscribe();
  });
});
