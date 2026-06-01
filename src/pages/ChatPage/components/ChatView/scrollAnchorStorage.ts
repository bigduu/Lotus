import { StorageManager } from "@services/storage/StorageManager";

const LEGACY_STORAGE_KEY = "chat_scroll_anchors_v1";
const V2_PREFIX = "chat_scroll_anchor_v2:";

export type ScrollAnchorV1 = {
  v: 1;
  anchorId: string;
  offsetPx: number;
  ts: number;
  indexHint?: number;
  createdAt?: string;
};

function isAnchorV1(x: unknown): x is ScrollAnchorV1 {
  if (!x || typeof x !== "object") return false;
  const a = x as Record<string, unknown>;
  return (
    a.v === 1 &&
    typeof a.anchorId === "string" &&
    typeof a.offsetPx === "number" &&
    typeof a.ts === "number"
  );
}

function readLegacyStore(): Record<string, ScrollAnchorV1> {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, ScrollAnchorV1> = {};
    for (const [sessionId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isAnchorV1(value)) out[sessionId] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function migrateFromLegacy(sessionId: string): ScrollAnchorV1 | null {
  const legacy = readLegacyStore();
  const anchor = legacy[sessionId];
  if (!anchor) return null;

  // Migrate to IndexedDB
  const manager = StorageManager.getInstance();
  manager.saveScrollAnchor(sessionId, anchor).catch(() => {});

  // Remove from legacy store and delete legacy key if empty
  delete legacy[sessionId];
  const remaining = Object.keys(legacy).length;
  try {
    if (remaining === 0) {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } else {
      localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(legacy));
    }
  } catch {
    // Best effort cleanup
  }

  return anchor;
}

export async function loadScrollAnchor(sessionId: string): Promise<ScrollAnchorV1 | null> {
  if (typeof window === "undefined") return null;

  // 1. Try IndexedDB via StorageManager
  try {
    const manager = StorageManager.getInstance();
    const fromDb = await manager.loadScrollAnchor(sessionId);
    if (fromDb) return fromDb;
  } catch {
    // fall through
  }

  // 2. Try v2 localStorage
  try {
    const raw = localStorage.getItem(`${V2_PREFIX}${sessionId}`);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (isAnchorV1(parsed)) {
        // Migrate to IndexedDB (async, don't await)
        const manager = StorageManager.getInstance();
        manager.saveScrollAnchor(sessionId, parsed).catch(() => {});
        return parsed;
      }
    }
  } catch {
    // fall through
  }

  // 3. Migrate from legacy v1 consolidated storage
  return migrateFromLegacy(sessionId);
}

export async function saveScrollAnchor(sessionId: string, anchor: ScrollAnchorV1): Promise<void> {
  if (typeof window === "undefined") return;

  // 1. Write to IndexedDB
  try {
    const manager = StorageManager.getInstance();
    await manager.saveScrollAnchor(sessionId, anchor);
  } catch (err) {
    console.warn("[ScrollAnchor] IndexedDB save failed:", err);
  }

  // 2. Also write to localStorage v2 as fallback
  try {
    localStorage.setItem(`${V2_PREFIX}${sessionId}`, JSON.stringify(anchor));
  } catch {
    // ignore
  }
}

export async function clearScrollAnchor(sessionId: string): Promise<void> {
  if (typeof window === "undefined") return;

  // Remove from IndexedDB
  try {
    const manager = StorageManager.getInstance();
    await manager.clearScrollAnchor(sessionId);
  } catch {
    // ignore
  }

  // Remove from localStorage
  try {
    localStorage.removeItem(`${V2_PREFIX}${sessionId}`);
  } catch {
    // ignore
  }
}
