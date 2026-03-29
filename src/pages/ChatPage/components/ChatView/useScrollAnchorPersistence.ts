import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import type { RenderableEntry } from "./useChatViewMessages";
import { loadScrollAnchor, saveScrollAnchor, type ScrollAnchorV1 } from "./scrollAnchorStorage";
import { restoreScrollAnchorUntilStable } from "./scrollAnchorRestore";

const SAVE_DEBOUNCE_MS = 300;
const OFFSET_EPS = 0.5; // localStorage write-threshold

function entryId(entry: RenderableEntry): string | null {
  if ("type" in entry && (entry.type === "tool_session" || entry.type === "compression_divider")) {
    return entry.id;
  }
  if ("message" in entry && entry.message) return entry.message.id;
  return null;
}

function entryCreatedAt(entry: RenderableEntry): string | undefined {
  if ("type" in entry && (entry.type === "tool_session" || entry.type === "compression_divider")) {
    return entry.createdAt;
  }
  if ("message" in entry && entry.message) return entry.message.createdAt;
  return undefined;
}

function parseTimeMs(iso?: string): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function resolveIndexFromDeletedAnchor(
  saved: ScrollAnchorV1,
  entries: RenderableEntry[],
): number | null {
  // 1) createdAt nearest
  const targetT = parseTimeMs(saved.createdAt);
  if (targetT != null) {
    let bestIdx: number | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < entries.length; i++) {
      const t = parseTimeMs(entryCreatedAt(entries[i]));
      if (t == null) continue;
      const d = Math.abs(t - targetT);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx != null) return bestIdx;
  }

  // 2) index hint
  if (typeof saved.indexHint === "number") {
    const clamped = Math.max(0, Math.min(entries.length - 1, saved.indexHint));
    return Number.isFinite(clamped) ? clamped : null;
  }

  return null;
}

function getEntryElements(scrollEl: HTMLDivElement): HTMLElement[] {
  return Array.from(scrollEl.querySelectorAll<HTMLElement>("[data-chat-entry-id]"));
}

function getEntryElementById(scrollEl: HTMLDivElement, id: string): HTMLElement | null {
  const entryElements = getEntryElements(scrollEl);
  for (const entryEl of entryElements) {
    if (entryEl.dataset.chatEntryId === id) return entryEl;
  }
  return null;
}

function getEntryElementByIndex(scrollEl: HTMLDivElement, index: number): HTMLElement | null {
  const entryElements = getEntryElements(scrollEl);
  if (entryElements.length === 0) return null;
  const clamped = Math.max(0, Math.min(entryElements.length - 1, index));
  return entryElements[clamped] ?? null;
}

function getFirstVisibleEntry(scrollEl: HTMLDivElement): HTMLElement | null {
  const entryElements = getEntryElements(scrollEl);
  if (entryElements.length === 0) return null;

  const viewportTop = scrollEl.getBoundingClientRect().top;
  for (const entryEl of entryElements) {
    if (entryEl.getBoundingClientRect().bottom > viewportTop) {
      return entryEl;
    }
  }

  return entryElements[entryElements.length - 1] ?? null;
}

export function useScrollAnchorPersistence(args: {
  currentSessionId: string | null;
  messagesListRef: RefObject<HTMLDivElement>;
  renderableMessages: RenderableEntry[];
}) {
  const { currentSessionId, messagesListRef, renderableMessages } = args;

  const restoredChatsRef = useRef<Set<string>>(new Set());
  const isRestoringRef = useRef(false);
  const restoreTokenRef = useRef(0);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<ScrollAnchorV1 | null>(null);
  const userInteractedRef = useRef(false);

  // Mark user interaction
  useEffect(() => {
    const el = messagesListRef.current;
    if (!el) return;

    const mark = () => {
      userInteractedRef.current = true;
    };

    el.addEventListener("wheel", mark, { passive: true });
    el.addEventListener("touchmove", mark, { passive: true });
    el.addEventListener("pointerdown", mark);

    return () => {
      el.removeEventListener("wheel", mark);
      el.removeEventListener("touchmove", mark);
      el.removeEventListener("pointerdown", mark);
    };
  }, [messagesListRef]);

  const idToIndex = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < renderableMessages.length; i++) {
      const id = entryId(renderableMessages[i]);
      if (id) map.set(id, i);
    }
    return map;
  }, [renderableMessages]);

  const computeAnchorNow = useCallback((): ScrollAnchorV1 | null => {
    const el = messagesListRef.current;
    if (!el) return null;
    if (renderableMessages.length === 0) return null;

    const anchorEl = getFirstVisibleEntry(el);
    if (!anchorEl) return null;

    const anchorId = anchorEl.dataset.chatEntryId;
    if (!anchorId) return null;

    const containerRect = el.getBoundingClientRect();
    const anchorRect = anchorEl.getBoundingClientRect();
    const indexHint = idToIndex.get(anchorId);
    const entry = typeof indexHint === "number" ? renderableMessages[indexHint] : undefined;

    return {
      v: 1,
      anchorId,
      offsetPx: anchorRect.top - containerRect.top,
      ts: Date.now(),
      indexHint,
      createdAt: entry ? entryCreatedAt(entry) : undefined,
    };
  }, [idToIndex, messagesListRef, renderableMessages]);

  const flushSave = useCallback(
    (sessionId: string) => {
      if (isRestoringRef.current) return;
      const anchor = computeAnchorNow();
      if (!anchor) return;

      const prev = lastSavedRef.current;
      if (
        prev &&
        prev.anchorId === anchor.anchorId &&
        Math.abs(prev.offsetPx - anchor.offsetPx) <= OFFSET_EPS
      ) {
        return;
      }

      saveScrollAnchor(sessionId, anchor);
      lastSavedRef.current = anchor;
    },
    [computeAnchorNow],
  );

  const handleScroll = useCallback(
    (_e: React.UIEvent<HTMLElement>) => {
      if (!currentSessionId) return;
      if (isRestoringRef.current) return;

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

      const sessionIdAtSchedule = currentSessionId;
      saveTimeoutRef.current = setTimeout(() => {
        flushSave(sessionIdAtSchedule);
      }, SAVE_DEBOUNCE_MS);
    },
    [currentSessionId, flushSave],
  );

  // Flush pending save when switching chat/unmounting
  useEffect(() => {
    const sessionIdAtRender = currentSessionId;
    return () => {
      if (!sessionIdAtRender) return;
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      flushSave(sessionIdAtRender);
    };
  }, [currentSessionId, flushSave]);

  // Restore (layout effect to reduce "jump from top")
  useLayoutEffect(() => {
    if (!currentSessionId) return;
    const el = messagesListRef.current;
    if (!el) return;
    if (renderableMessages.length === 0) return;

    if (restoredChatsRef.current.has(currentSessionId)) return;

    const saved = loadScrollAnchor(currentSessionId);
    if (!saved) {
      restoredChatsRef.current.add(currentSessionId);
      return;
    }

    const byId = idToIndex.get(saved.anchorId);
    const index =
      typeof byId === "number" ? byId : resolveIndexFromDeletedAnchor(saved, renderableMessages);

    if (index == null) {
      restoredChatsRef.current.add(currentSessionId);
      return;
    }

    // cancel any pending save during restore
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    const token = ++restoreTokenRef.current;
    isRestoringRef.current = true;
    userInteractedRef.current = false;

    el.style.overflowAnchor = "none";

    const isCancelled = () => restoreTokenRef.current !== token || userInteractedRef.current;

    restoreScrollAnchorUntilStable({
      scrollEl: el,
      getAnchorElement: () =>
        getEntryElementById(el, saved.anchorId) ?? getEntryElementByIndex(el, index),
      offsetPx: saved.offsetPx,
      isCancelled,
    }).finally(() => {
      if (restoreTokenRef.current !== token) return;

      isRestoringRef.current = false;
      restoredChatsRef.current.add(currentSessionId);

      el.style.overflowAnchor = "";

      // Persist the final stabilized anchor
      flushSave(currentSessionId);
    });

    return () => {
      // cancel restore loop
      if (restoreTokenRef.current === token) restoreTokenRef.current++;
    };
  }, [
    currentSessionId,
    idToIndex,
    renderableMessages,
    renderableMessages.length,
    messagesListRef,
    flushSave,
  ]);

  return { handleScroll };
}
