const STORAGE_KEY = "chat_scroll_anchors_v1";

export type ScrollAnchorV1 = {
  v: 1;
  anchorId: string;
  offsetPx: number;
  ts: number;
  indexHint?: number;
  createdAt?: string;
};

type Store = Record<string, ScrollAnchorV1>;

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

function readAll(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Store = {};
    for (const [sessionId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isAnchorV1(value)) out[sessionId] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function writeAll(next: Store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (err) {
    console.warn("[ScrollAnchor] Failed to write:", err);
  }
}

export function loadScrollAnchor(sessionId: string): ScrollAnchorV1 | null {
  return readAll()[sessionId] ?? null;
}

export function saveScrollAnchor(sessionId: string, anchor: ScrollAnchorV1) {
  const all = readAll();
  all[sessionId] = anchor;
  writeAll(all);
}

export function clearScrollAnchor(sessionId: string) {
  const all = readAll();
  delete all[sessionId];
  writeAll(all);
}
