import { useEffect, useRef, useState } from "react";

import { agentClient } from "@services/chat/AgentService";

import { CHILD_PREVIEW_MAX_CHARS } from "../hooks/useAgentEventSubscription.helpers";
import { getChildPreviewState } from "./childPreviewAtoms";

export interface ChildLivePreview {
  /** Rolling tail of the child's output (seed + live tokens). */
  preview: string;
  /** True while the dedicated child stream is connecting/open. */
  connecting: boolean;
}

const EMPTY: ChildLivePreview = { preview: "", connecting: false };

/**
 * Stream a single child actor's output by subscribing to the child's OWN event
 * stream (`GET /api/v1/events/{childId}`), independent of the parent session's
 * SSE.
 *
 * Why a dedicated stream: child actors are designed to outlive the parent's
 * turn, but the parent SSE is torn down the moment the parent completes — so
 * child events forwarded onto the parent stream land in a broadcast with no
 * receiver and the preview never renders. Subscribing directly to the child
 * decouples the preview from the parent's lifecycle entirely.
 *
 * Only active while `enabled` (i.e. the preview popover/modal is open), so at
 * most one or two child streams exist at a time — not one per accumulated child.
 *
 * Seeds from the already-accumulated parent-stream preview (or history for an
 * idle/completed child whose live stream yields only a one-shot terminal), then
 * appends live tokens.
 */
export function useChildLivePreview(
  parentSessionId: string | null | undefined,
  childSessionId: string | null | undefined,
  enabled: boolean,
): ChildLivePreview {
  const [preview, setPreview] = useState("");
  const [connecting, setConnecting] = useState(false);
  const bufRef = useRef("");
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || !childSessionId) {
      return;
    }

    let cancelled = false;
    const abort = new AbortController();

    // Seed from whatever the parent stream already accumulated for this child.
    const seed = getChildPreviewState(parentSessionId, childSessionId).outputPreview ?? "";
    bufRef.current = seed;
    setPreview(seed);
    setConnecting(true);

    const flush = () => {
      flushTimerRef.current = null;
      if (!cancelled) setPreview(bufRef.current);
    };
    const scheduleFlush = () => {
      if (flushTimerRef.current == null) {
        flushTimerRef.current = setTimeout(flush, 80);
      }
    };
    const append = (text: string) => {
      bufRef.current = (bufRef.current + text).slice(-CHILD_PREVIEW_MAX_CHARS);
      scheduleFlush();
    };

    // If we have no seed (e.g. an already-completed child the parent stream
    // never carried), pull the child's transcript so the popover isn't blank.
    if (!seed) {
      void (async () => {
        try {
          const history = await agentClient.getHistory(childSessionId);
          if (cancelled || bufRef.current) return;
          const tail = history.messages
            .filter((m) => m.role === "assistant" && m.content)
            .map((m) => m.content)
            .join("\n\n")
            .slice(-CHILD_PREVIEW_MAX_CHARS);
          if (tail) {
            bufRef.current = tail;
            setPreview(tail);
          }
        } catch {
          // best-effort seed; live tokens still flow below.
        }
      })();
    }

    void agentClient
      .subscribeToEvents(
        childSessionId,
        {
          onToken: (content) => append(content),
        },
        abort,
      )
      .catch(() => {
        // A preview connection failing is non-fatal; the seed still shows.
      })
      .finally(() => {
        if (!cancelled) setConnecting(false);
      });

    return () => {
      cancelled = true;
      abort.abort();
      if (flushTimerRef.current != null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, [enabled, parentSessionId, childSessionId]);

  if (!enabled) return EMPTY;
  return { preview, connecting };
}
