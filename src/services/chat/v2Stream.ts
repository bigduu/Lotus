/**
 * Opt-in unified v2 WebSocket client (`GET {origin}/v2/stream`).
 *
 * A module-level singleton managing ONE WebSocket shared by the account feed
 * and every per-session agent subscription. This is the dual-track replacement
 * for the two legacy SSE connections (`/api/v1/stream` + `/api/v1/events/{id}`)
 * and is gated behind the `apiV2Ws` feature flag (default OFF — see
 * `isApiV2WsEnabled`). When the flag is off this module is never touched.
 *
 * Protocol (JSON text frames):
 *  - Client to server: {type:"hello"} (optional; no token on loopback/local),
 *    {type:"subscribe", ch:"feed", since}, {type:"subscribe", ch:"agent.<sid>"},
 *    {type:"unsubscribe", ch}, {type:"stop", session_id}.
 *  - Server to client: event envelope {ch, seq, event} and control envelope
 *    {ch, seq, control:{type:"terminal"|"feed_reset", ...}}.
 *
 * Reconnect: a single bounded-backoff reconnect loop owns the socket. On every
 * (re)connect a `hello` is sent and ALL live channels are re-subscribed (feed
 * with its latest cursor, agents with their sid) — mirroring the EventSource
 * auto-reconnect + Last-Event-ID behavior. A `feed_reset` control clears the
 * feed cursor so the next (re)subscribe resyncs from scratch.
 *
 * Lifetime: the socket is opened lazily on the first subscribe and closed once
 * no subscriptions (feed or agent) remain.
 */
import type {
  AccountStreamHandlers,
  AgentEvent,
  AgentEventHandlers,
  ChangeEvent,
} from "./AgentService";
import { getV2StreamUrl } from "@shared/utils/backendBaseUrl";
import { debugLog } from "@shared/utils/debugFlags";

/** Subscription handle returned by {@link subscribeFeed}. */
export interface FeedSubscription {
  close(): void;
}

/**
 * Dispatch a fully-parsed AgentEvent to the appropriate AgentEventHandlers
 * callback. Injected by AgentService so the WS path reuses the exact same
 * event-to-handler mapping as the SSE `onmessage` path (no logic fork).
 */
export type AgentEventDispatch = (event: AgentEvent, handlers: AgentEventHandlers) => void;

const MAX_BACKOFF_MS = 15_000;
const BASE_BACKOFF_MS = 500;

interface FeedChannel {
  handlers: AccountStreamHandlers;
  /** Latest cursor to (re)subscribe with; updated as ChangeEvents arrive. */
  since: number;
}

interface AgentChannel {
  sessionId: string;
  handlers: AgentEventHandlers;
  dispatch: AgentEventDispatch;
  /** Resolves the subscribe Promise on a `terminal` control (or unsubscribe). */
  resolve: () => void;
}

type ServerFrame = {
  ch?: string;
  seq?: number;
  event?: unknown;
  control?: { type?: string; [key: string]: unknown };
};

let socket: WebSocket | null = null;
let connecting = false;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let intentionalClose = false;

let feedChannel: FeedChannel | null = null;
const agentChannels = new Map<string, AgentChannel>();

const agentCh = (sessionId: string): string => `agent.${sessionId}`;

const hasSubscriptions = (): boolean => feedChannel !== null || agentChannels.size > 0;

const send = (payload: Record<string, unknown>): void => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    try {
      socket.send(JSON.stringify(payload));
    } catch (error) {
      debugLog("[v2Stream]", "send.error", { payload, error });
    }
  }
};

/** (Re)send the subscribe frames for every live channel after a (re)connect. */
const resubscribeAll = (): void => {
  send({ type: "hello" });
  if (feedChannel) {
    send({ type: "subscribe", ch: "feed", since: feedChannel.since });
  }
  for (const channel of agentChannels.values()) {
    send({ type: "subscribe", ch: agentCh(channel.sessionId) });
  }
};

const clearReconnectTimer = (): void => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
};

const scheduleReconnect = (): void => {
  if (!hasSubscriptions() || intentionalClose) return;
  if (reconnectTimer) return;
  const delay = Math.min(BASE_BACKOFF_MS * 2 ** reconnectAttempts, MAX_BACKOFF_MS);
  reconnectAttempts += 1;
  debugLog("[v2Stream]", "reconnect.schedule", { attempt: reconnectAttempts, delay });
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
};

const teardownSocket = (): void => {
  if (socket) {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      /* ignore */
    }
    socket = null;
  }
};

const closeIfIdle = (): void => {
  if (hasSubscriptions()) return;
  intentionalClose = true;
  clearReconnectTimer();
  teardownSocket();
  connecting = false;
  reconnectAttempts = 0;
};

const handleFrame = (raw: string): void => {
  let frame: ServerFrame;
  try {
    frame = JSON.parse(raw) as ServerFrame;
  } catch (error) {
    console.warn("Failed to parse v2 stream frame:", raw, error);
    return;
  }

  if (!frame || typeof frame.ch !== "string") {
    debugLog("[v2Stream]", "frame.unknown", { raw });
    return;
  }

  const { ch, control, event } = frame;

  if (ch === "feed") {
    if (!feedChannel) return;
    if (control) {
      if (control.type === "feed_reset") {
        debugLog("[v2Stream]", "feed.reset", {});
        feedChannel.since = 0;
        feedChannel.handlers.onReset?.();
      }
      return;
    }
    if (event === undefined) {
      debugLog("[v2Stream]", "feed.frame.no_event", { raw });
      return;
    }
    const change = event as ChangeEvent;
    if (typeof change.seq === "number" && change.seq > feedChannel.since) {
      feedChannel.since = change.seq;
    }
    feedChannel.handlers.onChange(change);
    return;
  }

  if (ch.startsWith("agent.")) {
    const channel = agentChannels.get(ch);
    if (!channel) return;
    if (control) {
      if (control.type === "terminal") {
        debugLog("[v2Stream]", "agent.terminal", { ch });
        channel.resolve();
      }
      return;
    }
    if (event === undefined) {
      debugLog("[v2Stream]", "agent.frame.no_event", { raw });
      return;
    }
    try {
      channel.dispatch(event as AgentEvent, channel.handlers);
    } catch (error) {
      console.warn("Failed to dispatch v2 agent event:", raw, error);
    }
    return;
  }

  debugLog("[v2Stream]", "frame.unknown_channel", { ch });
};

const connect = (): void => {
  if (!hasSubscriptions()) return;
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }
  if (connecting) return;
  if (typeof WebSocket === "undefined") {
    debugLog("[v2Stream]", "connect.no_websocket", {});
    return;
  }

  connecting = true;
  intentionalClose = false;
  const url = getV2StreamUrl();
  debugLog("[v2Stream]", "connect", { url });

  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch (error) {
    connecting = false;
    debugLog("[v2Stream]", "connect.error", { error });
    feedChannel?.handlers.onError?.();
    scheduleReconnect();
    return;
  }
  socket = ws;

  ws.onopen = () => {
    connecting = false;
    reconnectAttempts = 0;
    debugLog("[v2Stream]", "open", {});
    resubscribeAll();
    feedChannel?.handlers.onOpen?.();
  };

  ws.onmessage = (messageEvent: MessageEvent) => {
    const data = messageEvent.data;
    if (typeof data !== "string") return;
    handleFrame(data);
  };

  ws.onerror = () => {
    debugLog("[v2Stream]", "error", {});
    feedChannel?.handlers.onError?.();
  };

  ws.onclose = () => {
    connecting = false;
    debugLog("[v2Stream]", "close", { intentional: intentionalClose });
    if (socket === ws) socket = null;
    if (intentionalClose) return;
    feedChannel?.handlers.onError?.();
    scheduleReconnect();
  };
};

/**
 * Subscribe to the account change feed over the shared v2 WebSocket.
 *
 * Mirrors `AgentClient.subscribeToAccountStream`: routes feed `event`
 * envelopes (full ChangeEvent) to `handlers.onChange`, a `feed_reset` control
 * to `handlers.onReset`, WS open to `handlers.onOpen`, and close/error to
 * `handlers.onError`. The caller owns the cursor (localStorage) and passes the
 * resume point as `since`; the client tracks the max seq seen for reconnects.
 */
export const subscribeFeed = (handlers: AccountStreamHandlers, since: number): FeedSubscription => {
  feedChannel = { handlers, since: since > 0 ? since : 0 };
  if (socket && socket.readyState === WebSocket.OPEN) {
    send({ type: "subscribe", ch: "feed", since: feedChannel.since });
  } else {
    connect();
  }

  let closed = false;
  return {
    close() {
      if (closed) return;
      closed = true;
      feedChannel = null;
      send({ type: "unsubscribe", ch: "feed" });
      closeIfIdle();
    },
  };
};

/**
 * Subscribe to a single session's agent event channel over the shared v2 WS.
 *
 * Mirrors the SSE `subscribeToEvents` semantics so callers need no change:
 *  - Each `event` envelope is dispatched through the injected `dispatch` (the
 *    same AgentEventHandlers mapping the SSE path used).
 *  - A `terminal` control resolves the returned Promise.
 *  - Calling `close()` unsubscribes the channel and resolves the Promise
 *    (mirrors the abort-closes behavior).
 *  - A transient WS disconnect does NOT reject — this client reconnects and
 *    re-subscribes internally, so the Promise stays pending until terminal or
 *    abort (the WS owns reconnection, unlike the native EventSource path).
 *
 * Returns the Promise plus a `close()` to unsubscribe.
 */
export const subscribeAgent = (
  sessionId: string,
  handlers: AgentEventHandlers,
  dispatch: AgentEventDispatch,
): { promise: Promise<void>; close: () => void } => {
  const ch = agentCh(sessionId);
  let settled = false;
  let resolveFn: () => void = () => {};

  const promise = new Promise<void>((resolve) => {
    resolveFn = () => {
      if (settled) return;
      settled = true;
      agentChannels.delete(ch);
      send({ type: "unsubscribe", ch });
      closeIfIdle();
      resolve();
    };
  });

  agentChannels.set(ch, { sessionId, handlers, dispatch, resolve: resolveFn });

  if (socket && socket.readyState === WebSocket.OPEN) {
    send({ type: "subscribe", ch });
  } else {
    connect();
  }

  return { promise, close: resolveFn };
};

/** Test-only: reset the singleton state between cases. */
export const __resetV2StreamForTests = (): void => {
  clearReconnectTimer();
  intentionalClose = true;
  teardownSocket();
  connecting = false;
  reconnectAttempts = 0;
  feedChannel = null;
  agentChannels.clear();
};
