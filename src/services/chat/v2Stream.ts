/**
 * Unified v2 WebSocket client (`GET {origin}/v2/stream`), the DEFAULT transport.
 *
 * A module-level singleton managing ONE WebSocket shared by the account feed
 * and every per-session agent subscription. This is the dual-track replacement
 * for the two legacy SSE connections (`/api/v1/stream` + `/api/v1/events/{id}`)
 * and is gated behind the `apiV2Ws` feature flag — **default ON (opt-out)**: see
 * `isApiV2WsEnabled`, which returns true unless `localStorage.bodhi_api_v2_ws`
 * is explicitly `"0"`/`"false"`. When opted out this module is never touched and
 * the client falls back to the legacy SSE transport.
 *
 * Protocol (JSON text frames by default):
 *  - Client to server: {type:"hello"} (optional; no token on loopback/local),
 *    {type:"subscribe", ch:"feed", since}, {type:"subscribe", ch:"agent.<sid>"},
 *    {type:"unsubscribe", ch}, {type:"stop", session_id}, {type:"ping"}.
 *  - Server to client: event envelope {ch, seq, event} and control envelope
 *    {ch, seq, control:{type:"terminal"|"feed_reset", ...}}, or {type:"pong"}.
 *
 * Wire encoding (opt-in MessagePack): by default the socket speaks JSON text
 * frames. When `isApiV2MsgpackEnabled()` is on, the socket is opened offering
 * the `bamboo.v2.msgpack` subprotocol via `Sec-WebSocket-Protocol`; the SAME
 * envelope schema is then carried as MessagePack binary frames. The active
 * encoding is decided from the NEGOTIATED `ws.protocol` after open: if the
 * backend echoes `bamboo.v2.msgpack` we encode/decode msgpack, otherwise (an
 * older JSON-only backend leaves `ws.protocol` empty) we stay on JSON even
 * though we offered msgpack. JSON remains the default and is byte-for-byte
 * unchanged when the flag is off.
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
import { debugLog, isApiV2MsgpackEnabled } from "@shared/utils/debugFlags";
import { getDeviceCredential } from "@shared/utils/deviceAuth";
import { decode as msgpackDecode, encode as msgpackEncode } from "@msgpack/msgpack";

/** Subscription handle returned by {@link subscribeFeed}. */
export interface FeedSubscription {
  close(): void;
}

/**
 * Optional callback a subscriber can register to learn that the shared socket
 * FAILED its very first connection (errored/closed before ever opening, or did
 * not open within {@link OPEN_TIMEOUT_MS}). Fires AT MOST ONCE per subscription,
 * and ONLY for the initial connect — once the socket has opened even once,
 * subsequent drops are handled by the internal reconnect loop and this NEVER
 * fires. This is the signal `AgentService` uses to transparently fall back to
 * the legacy SSE transport on an old/unreachable backend.
 */
export type ConnectFailedCallback = () => void;

/**
 * Dispatch a fully-parsed AgentEvent to the appropriate AgentEventHandlers
 * callback. Injected by AgentService so the WS path reuses the exact same
 * event-to-handler mapping as the SSE `onmessage` path (no logic fork).
 */
export type AgentEventDispatch = (event: AgentEvent, handlers: AgentEventHandlers) => void;

const MAX_BACKOFF_MS = 15_000;
const BASE_BACKOFF_MS = 500;

/**
 * The MessagePack subprotocol token offered via `Sec-WebSocket-Protocol` when
 * `isApiV2MsgpackEnabled()` is on, and echoed by the backend on the handshake
 * response when it supports binary frames. Must match the bamboo backend.
 */
const MSGPACK_SUBPROTOCOL = "bamboo.v2.msgpack";

/**
 * How long the FIRST connection attempt may take before it is declared a
 * connect failure. Bounded so a client pointed at an old backend (no
 * `/v2/stream`) or an unreachable host degrades to SSE within a few seconds
 * instead of hanging the UI behind retry-forever backoff.
 */
const OPEN_TIMEOUT_MS = 3_500;

/**
 * Minimum time a connection must stay open to count as genuinely usable. The
 * backend closes an unauthenticated socket after a ~10s auth deadline; a value
 * comfortably above that means an auth-deadline drop registers as "short-lived"
 * rather than a stable connection. A connection that survives longer than this
 * resets the short-lived counter (see {@link shortLivedCloses}).
 */
const STABLE_OPEN_MS = 15_000;

/**
 * How many consecutive short-lived opens (open then close within
 * {@link STABLE_OPEN_MS}) are tolerated before the socket is declared a connect
 * failure and we fall back to SSE. Bounds the auth-deadline flap to ~3 cycles
 * instead of reconnecting forever.
 */
const MAX_SHORTLIVED = 3;

/** Browser-visible application heartbeat; protocol Ping/Pong is hidden from JS. */
const HEARTBEAT_INTERVAL_MS = 15_000;
/** Acknowledged connections are considered half-open after this much silence. */
const HEARTBEAT_STALE_MS = 40_000;

/** How often the watchdog checks for staleness. */
const WATCHDOG_TICK_MS = 1_000;

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
  /**
   * Last envelope `seq` seen on this channel. The server mints a
   * per-subscription monotonic seq (1-based, restarts on every (re)subscribe —
   * it is NOT a durable resume cursor), so within one subscription a hole in
   * the sequence means frames were skipped server-side after seq minting
   * (e.g. an envelope-encode failure) — treated as a gap (#98). `0` until the
   * first frame; reset on reconnect (new forwarder → seq restarts at 1).
   */
  lastSeq: number;
}

type ServerFrame = {
  type?: string;
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
/**
 * A stale socket has proven that v2 WS works but the transport went half-open.
 * Keep all subsequent recovery attempts on WS even if replacement sockets flap:
 * falling back to SSE here would violate post-open recovery semantics.
 */
let watchdogRecoveryActive = false;

/**
 * Whether the shared socket has EVER successfully opened (across its whole
 * lifetime, including reconnects). Distinguishes an initial-connect failure
 * (still `false`) from a post-open drop (`true` → reconnect, never fall back).
 * Reset only by {@link __resetV2StreamForTests} and {@link closeIfIdle} once all
 * subscriptions are gone — i.e. each app "session" re-evaluates connectivity.
 */
let everOpened = false;
/** Whether an initial-connect failure has already been signaled (fire-once). */
let connectFailed = false;
/**
 * Timestamp (ms) of the most recent `onopen` for the live socket, used to
 * measure connection uptime on `onclose` and classify short-lived flaps.
 * `null` while no socket is open.
 */
let lastOpenAt: number | null = null;
/**
 * Count of consecutive short-lived opens (open then close within
 * {@link STABLE_OPEN_MS}). A close after a stable open resets this to 0; once it
 * reaches {@link MAX_SHORTLIVED} the socket is declared a connect failure and we
 * fall back to SSE. See {@link signalConnectFailed}.
 */
let shortLivedCloses = 0;
/** Bounds the FIRST open attempt; cleared on open or on failure. */
let openTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * Callbacks registered by live subscriptions to be notified of an
 * initial-connect failure. Drained (and cleared) exactly once when failure is
 * declared; thereafter newly-registered callbacks are answered synchronously by
 * {@link registerConnectFailed} (since the verdict is already known).
 */
const connectFailedListeners = new Set<ConnectFailedCallback>();

/**
 * Timestamp (ms) of the most recent inbound frame on the LIVE socket (any
 * channel, keepalives included). The watchdog's staleness clock.
 */
let lastFrameAt = 0;
/**
 * Whether the CURRENT connection has acknowledged at least one client ping.
 * This gates the watchdog for compatibility with older backends that ignore
 * the new frame and may legitimately remain quiet for a long time.
 */
let heartbeatAckSeen = false;
/** Sends application pings while the socket is open. */
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
/** The watchdog interval; armed while a socket is open. */
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
/** Visibility listener that runs the same stale check immediately after resume. */
let visibilityWatchdogAttached = false;

let feedChannel: FeedChannel | null = null;
const agentChannels = new Map<string, AgentChannel>();

const agentCh = (sessionId: string): string => `agent.${sessionId}`;

const hasSubscriptions = (): boolean => feedChannel !== null || agentChannels.size > 0;

/**
 * Whether the LIVE socket negotiated the MessagePack subprotocol. Decided from
 * the post-handshake `ws.protocol`: only when the backend echoes
 * `bamboo.v2.msgpack` do we encode/decode binary. If we offered msgpack but the
 * backend did not echo it (older JSON-only backend → empty `ws.protocol`), this
 * is false and we stay on JSON. Safe to call any time; defaults to JSON.
 */
const isMsgpackActive = (): boolean => socket !== null && socket.protocol === MSGPACK_SUBPROTOCOL;

const send = (payload: Record<string, unknown>): void => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    try {
      // Encoding is chosen from the post-open `ws.protocol`, so frames queued
      // before open (flushed here on open via resubscribeAll) get the correct
      // negotiated encoding — the handshake has completed by the time we send.
      socket.send(isMsgpackActive() ? msgpackEncode(payload) : JSON.stringify(payload));
    } catch (error) {
      debugLog("[v2Stream]", "send.error", { payload, error });
    }
  }
};

/** (Re)send the subscribe frames for every live channel after a (re)connect. */
const resubscribeAll = (): void => {
  // v2-P2 (#181/#189; epic #26 phase 1): include the paired device credential
  // ONLY when one is stored — a desktop/loopback client with no credential
  // sends the exact same `{type:"hello"}` frame as before (byte-for-byte
  // no-op), since local_bypass never calls `setDeviceCredential`.
  const credential = getDeviceCredential();
  send(
    credential
      ? { type: "hello", device_id: credential.device_id, token: credential.token }
      : { type: "hello" },
  );
  if (feedChannel) {
    send({ type: "subscribe", ch: "feed", since: feedChannel.since });
  }
  for (const channel of agentChannels.values()) {
    // A (re)connect spawns fresh server forwarders whose seq restarts at 1 —
    // reset continuity tracking so the restart is never misread as a gap (#98).
    channel.lastSeq = 0;
    send({ type: "subscribe", ch: agentCh(channel.sessionId) });
  }
};

const clearReconnectTimer = (): void => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
};

const clearOpenTimeout = (): void => {
  if (openTimeoutTimer) {
    clearTimeout(openTimeoutTimer);
    openTimeoutTimer = null;
  }
};

/**
 * Register a per-subscription callback for the initial-connect verdict.
 *
 * - If the socket has already opened once, there is nothing to wait for: the
 *   verdict is "connected", so the callback NEVER fires.
 * - If failure has already been declared (old/unreachable backend), answer
 *   synchronously so a late subscriber still falls back to SSE.
 * - Otherwise enqueue it; it fires once if/when the first attempt fails.
 */
const registerConnectFailed = (onConnectFailed?: ConnectFailedCallback): void => {
  if (!onConnectFailed) return;
  if (everOpened) return;
  if (connectFailed) {
    // Failure is already known, but DEFER the fire to a microtask: this function
    // runs SYNCHRONOUSLY inside the caller's `subscribe*` body, before that
    // body's later `let closed` / `const { close }` bindings are initialized.
    // Firing inline would run the caller's fallback closure while those
    // identifiers are still in their temporal dead zone → ReferenceError. The
    // microtask lets the caller finish initializing first. Re-check liveness on
    // fire so a subscription torn down meanwhile is not answered.
    const listener = onConnectFailed;
    queueMicrotask(() => {
      if (everOpened) return;
      if (!connectFailed) return;
      listener();
    });
    return;
  }
  connectFailedListeners.add(onConnectFailed);
};

/**
 * Declare the FIRST connection attempt a failure: tear the socket down (no
 * retry-forever — the caller falls back to SSE) and fire every registered
 * `onConnectFailed` exactly once. A no-op once the socket has ever opened (a
 * post-open drop must go through the reconnect loop, never fall back) or once a
 * failure was already signaled.
 */
const signalConnectFailed = (opts?: { force?: boolean }): void => {
  // Normally a no-op once the socket has ever opened (post-open drops must use
  // the reconnect loop). `force` overrides this for the short-lived-flap case
  // (H2): a socket that keeps opening then closing within STABLE_OPEN_MS is not
  // usable, so we degrade to SSE even though `everOpened` is true.
  if (connectFailed) return;
  if (everOpened && !opts?.force) return;
  connectFailed = true;
  clearOpenTimeout();
  clearReconnectTimer();
  intentionalClose = true; // stop onclose from scheduling a reconnect
  teardownSocket();
  connecting = false;
  debugLog("[v2Stream]", "connect.failed_initial", {});
  const listeners = [...connectFailedListeners];
  connectFailedListeners.clear();
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      debugLog("[v2Stream]", "connect.failed_initial.listener_error", { error });
    }
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

const clearWatchdog = (): void => {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
};

const clearHeartbeat = (): void => {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
};

/**
 * Declare the live socket stale and force a reconnect (lotus#87). Runs the
 * SAME teardown+reconnect sequence as a post-open `onclose` — deliberately NOT
 * routed through `socket.close()` + the `onclose` handler, because on a
 * half-open socket the browser's close timing is exactly what we can't rely
 * on. 40s of silence implies the connection was stable before the stall, so
 * the short-lived-flap counter resets (mirrors the stable-drop branch).
 */
const forceReconnectStaleSocket = (): void => {
  debugLog("[v2Stream]", "watchdog.stale_socket", {
    silentForMs: Date.now() - lastFrameAt,
  });
  feedChannel?.handlers.onError?.();
  teardownSocket();
  lastOpenAt = null;
  shortLivedCloses = 0;
  watchdogRecoveryActive = true;
  scheduleReconnect();
};

/** One watchdog check: armed only after this connection's first pong ACK. */
const watchdogTick = (): void => {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  if (!heartbeatAckSeen) return;
  if (Date.now() - lastFrameAt >= HEARTBEAT_STALE_MS) {
    forceReconnectStaleSocket();
  }
};

const onVisibilityChange = (): void => {
  if (document.visibilityState === "visible") {
    // Browser timers may remain throttled briefly after a suspended tab wakes.
    // Reuse the exact periodic-watchdog check so an acknowledged half-open
    // socket enters the normal teardown/reconnect/resubscribe path immediately.
    watchdogTick();
  }
};

const attachVisibilityWatchdog = (): void => {
  if (visibilityWatchdogAttached || typeof document === "undefined") return;
  document.addEventListener("visibilitychange", onVisibilityChange);
  visibilityWatchdogAttached = true;
};

const detachVisibilityWatchdog = (): void => {
  if (!visibilityWatchdogAttached || typeof document === "undefined") return;
  document.removeEventListener("visibilitychange", onVisibilityChange);
  visibilityWatchdogAttached = false;
};

const armWatchdog = (): void => {
  clearWatchdog();
  watchdogTimer = setInterval(watchdogTick, WATCHDOG_TICK_MS);
  attachVisibilityWatchdog();
};

const startHeartbeat = (): void => {
  clearHeartbeat();
  heartbeatTimer = setInterval(() => send({ type: "ping" }), HEARTBEAT_INTERVAL_MS);
};

const teardownSocket = (): void => {
  clearHeartbeat();
  clearWatchdog();
  detachVisibilityWatchdog();
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
  clearOpenTimeout();
  teardownSocket();
  connecting = false;
  reconnectAttempts = 0;
  // All subscriptions are gone: re-arm connectivity detection so the next app
  // "session" (next subscribe) gets a fresh open-timeout / fallback decision.
  everOpened = false;
  connectFailed = false;
  lastOpenAt = null;
  shortLivedCloses = 0;
  watchdogRecoveryActive = false;
  connectFailedListeners.clear();
};

/**
 * Decode a raw inbound WS frame into a {@link ServerFrame}, picking the codec
 * from the frame shape: an `ArrayBuffer`/binary payload is MessagePack (msgpack
 * mode), a string is JSON (default). Returns `undefined` on an undecodable
 * frame; the caller logs + ignores (never throws out of `onmessage`).
 */
const decodeFrame = (data: unknown): ServerFrame | undefined => {
  try {
    if (typeof data === "string") {
      return JSON.parse(data) as ServerFrame;
    }
    if (data instanceof ArrayBuffer) {
      return msgpackDecode(new Uint8Array(data)) as ServerFrame;
    }
    if (ArrayBuffer.isView(data)) {
      const view = data as ArrayBufferView;
      return msgpackDecode(
        new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
      ) as ServerFrame;
    }
    debugLog("[v2Stream]", "frame.unknown_data_type", {});
    return undefined;
  } catch (error) {
    console.warn("Failed to parse v2 stream frame:", data, error);
    return undefined;
  }
};

const handleFrame = (frame: ServerFrame | undefined): void => {
  if (frame?.type === "pong") {
    if (!heartbeatAckSeen) {
      heartbeatAckSeen = true;
      debugLog("[v2Stream]", "heartbeat.acknowledged", {});
    }
    return;
  }
  if (!frame || typeof frame.ch !== "string") {
    debugLog("[v2Stream]", "frame.unknown", {});
    return;
  }

  const { ch, control, event } = frame;

  if (ch === "sys") {
    return;
  }

  if (ch === "feed") {
    if (!feedChannel) return;
    if (control) {
      if (control.type === "feed_reset") {
        debugLog("[v2Stream]", "feed.reset", {});
        const fromSeq = typeof control.from_seq === "number" ? control.from_seq : feedChannel.since;
        feedChannel.since = 0;
        feedChannel.handlers.onReset?.({
          type: "feed_reset",
          from_seq: fromSeq,
        });
      }
      return;
    }
    if (event === undefined) {
      debugLog("[v2Stream]", "feed.frame.no_event", {});
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
    // Seq-continuity check (#98): every agent envelope — event AND control —
    // carries the forwarder's per-subscription monotonic seq. A HOLE within one
    // subscription means frames were skipped server-side after seq minting
    // (e.g. an envelope-encode failure) — a loss the server's broadcast-lag
    // `gap` control cannot see (ring loss happens BEFORE minting). Treat it
    // exactly like a declared gap. `seq <= lastSeq` is a forwarder restart
    // (server-side re-subscribe restarts at 1): reset tracking, never a gap.
    const seq = typeof frame.seq === "number" ? frame.seq : 0;
    if (seq > 0) {
      if (channel.lastSeq > 0 && seq > channel.lastSeq + 1) {
        const missed = seq - channel.lastSeq - 1;
        debugLog("[v2Stream]", "agent.seq_gap", {
          ch,
          expected: channel.lastSeq + 1,
          got: seq,
          missed,
        });
        channel.handlers.onStreamGap?.(missed);
      }
      channel.lastSeq = seq;
    }
    if (control) {
      if (control.type === "terminal") {
        debugLog("[v2Stream]", "agent.terminal", { ch });
        channel.resolve();
      } else if (control.type === "gap") {
        // The server's broadcast ring overran: events were lost beyond recovery
        // (bamboo#543). Surface it so the subscriber reconciles via REST.
        const skipped = typeof control.skipped === "number" ? control.skipped : 0;
        debugLog("[v2Stream]", "agent.gap", { ch, skipped });
        channel.handlers.onStreamGap?.(skipped);
      }
      return;
    }
    if (event === undefined) {
      debugLog("[v2Stream]", "agent.frame.no_event", {});
      return;
    }
    try {
      channel.dispatch(event as AgentEvent, channel.handlers);
    } catch (error) {
      console.warn("Failed to dispatch v2 agent event:", event, error);
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

  // Opt-in: offer the msgpack subprotocol so the backend can negotiate binary
  // frames. Safe against a JSON-only backend — if it does not echo the protocol
  // on the handshake, `ws.protocol` stays empty and we decode JSON (see
  // `isMsgpackActive`). Default (flag off) opens exactly as before: no
  // protocols arg, JSON text.
  const offerMsgpack = isApiV2MsgpackEnabled();
  let ws: WebSocket;
  try {
    ws = offerMsgpack ? new WebSocket(url, [MSGPACK_SUBPROTOCOL]) : new WebSocket(url);
    if (offerMsgpack) {
      // Receive binary frames as ArrayBuffer (the default `Blob` is async to
      // read); decoding in `onmessage` needs synchronous access to the bytes.
      ws.binaryType = "arraybuffer";
    }
  } catch (error) {
    connecting = false;
    debugLog("[v2Stream]", "connect.error", { error });
    // Synchronous construction failure on the very first attempt is an
    // initial-connect failure → fall back to SSE (do not retry-forever).
    if (!everOpened) {
      feedChannel?.handlers.onError?.();
      // DEFER: a `new WebSocket()` throw runs SYNCHRONOUSLY inside
      // `subscribeFeed`/`subscribeAgent`, so firing the connect-failed
      // listeners now would re-enter the caller's closure before its
      // `wsHandle`/`active` bindings are initialized (temporal-dead-zone
      // ReferenceError, silently swallowed → no fallback, stuck no-events
      // feed). A microtask lets the subscribe call return first, so the
      // handle is assigned and `wsHandle.close()` (which nulls feedChannel +
      // resets connectivity) runs as intended.
      queueMicrotask(() => signalConnectFailed());
      return;
    }
    feedChannel?.handlers.onError?.();
    scheduleReconnect();
    return;
  }
  socket = ws;

  // Arm the open-timeout for the FIRST connection attempt only. If the socket
  // does not open within the bound, declare an initial-connect failure so the
  // UI degrades to SSE instead of stalling behind reconnect backoff.
  if (!everOpened && !openTimeoutTimer) {
    openTimeoutTimer = setTimeout(() => {
      openTimeoutTimer = null;
      if (!everOpened) {
        debugLog("[v2Stream]", "connect.open_timeout", {});
        signalConnectFailed();
      }
    }, OPEN_TIMEOUT_MS);
  }

  ws.onopen = () => {
    connecting = false;
    reconnectAttempts = 0;
    everOpened = true;
    lastOpenAt = Date.now();
    clearOpenTimeout();
    // Fresh liveness state per connection. Pings begin immediately, but the
    // watchdog remains disarmed until this backend proves support with a pong.
    lastFrameAt = Date.now();
    heartbeatAckSeen = false;
    startHeartbeat();
    armWatchdog();
    debugLog("[v2Stream]", "open", {});
    resubscribeAll();
    feedChannel?.handlers.onOpen?.();
  };

  ws.onmessage = (messageEvent: MessageEvent) => {
    // Every inbound frame — keepalive or business — proves the socket alive.
    lastFrameAt = Date.now();
    // Decode by frame shape: string → JSON, ArrayBuffer/binary → msgpack. A
    // malformed/undecodable frame is logged + ignored inside decodeFrame, so
    // this never throws out of onmessage (same discipline as the JSON path).
    handleFrame(decodeFrame(messageEvent.data));
  };

  ws.onerror = () => {
    debugLog("[v2Stream]", "error", {});
    feedChannel?.handlers.onError?.();
  };

  ws.onclose = () => {
    connecting = false;
    // A closed socket must never leave its ping/watchdog intervals running
    // during reconnect backoff. `onclose` can arrive without teardownSocket.
    clearHeartbeat();
    clearWatchdog();
    debugLog("[v2Stream]", "close", { intentional: intentionalClose, everOpened });
    if (socket === ws) socket = null;
    if (intentionalClose) return;
    // Closed before it ever opened → initial-connect failure → fall back to SSE
    // (do NOT reconnect-forever, which would hang the UI on an old backend).
    if (!everOpened) {
      feedChannel?.handlers.onError?.();
      signalConnectFailed();
      return;
    }
    // Post-open drop. Classify it: a connection that stayed open longer than
    // STABLE_OPEN_MS was genuinely usable (a normal transient drop) → reconnect
    // and reset the short-lived counter. A connection that closed within the
    // stability window is "short-lived" (e.g. the backend's ~10s unauthenticated
    // auth-deadline); after MAX_SHORTLIVED such closes in a row we stop the
    // unbounded flap and fall back to SSE.
    const openedFor = lastOpenAt === null ? 0 : Date.now() - lastOpenAt;
    lastOpenAt = null;
    if (openedFor >= STABLE_OPEN_MS) {
      shortLivedCloses = 0;
    } else {
      shortLivedCloses += 1;
      debugLog("[v2Stream]", "close.short_lived", { openedFor, shortLivedCloses });
      if (shortLivedCloses >= MAX_SHORTLIVED && !watchdogRecoveryActive) {
        debugLog("[v2Stream]", "close.short_lived.fallback", { shortLivedCloses });
        feedChannel?.handlers.onError?.();
        signalConnectFailed({ force: true });
        return;
      }
    }
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
 *
 * `onConnectFailed` (optional) fires AT MOST ONCE if the shared socket's very
 * first connection never opens (errors/closes before open, or times out). After
 * a successful first open it never fires; post-open drops use the internal
 * reconnect. AgentService passes this to fall back to the legacy SSE feed.
 */
export const subscribeFeed = (
  handlers: AccountStreamHandlers,
  since: number,
  onConnectFailed?: ConnectFailedCallback,
): FeedSubscription => {
  feedChannel = { handlers, since: since > 0 ? since : 0 };
  registerConnectFailed(onConnectFailed);
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
 * `onConnectFailed` (optional) fires AT MOST ONCE if the shared socket's very
 * first connection never opens (errors/closes before open, or times out). After
 * a successful first open it never fires; post-open drops use the internal
 * reconnect. AgentService passes this to fall back to the legacy SSE agent path.
 *
 * Returns the Promise plus a `close()` to unsubscribe.
 */
export const subscribeAgent = (
  sessionId: string,
  handlers: AgentEventHandlers,
  dispatch: AgentEventDispatch,
  onConnectFailed?: ConnectFailedCallback,
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

  agentChannels.set(ch, { sessionId, handlers, dispatch, resolve: resolveFn, lastSeq: 0 });
  registerConnectFailed(onConnectFailed);

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
  clearOpenTimeout();
  intentionalClose = true;
  teardownSocket();
  connecting = false;
  reconnectAttempts = 0;
  everOpened = false;
  connectFailed = false;
  lastOpenAt = null;
  shortLivedCloses = 0;
  watchdogRecoveryActive = false;
  connectFailedListeners.clear();
  feedChannel = null;
  agentChannels.clear();
  lastFrameAt = 0;
  heartbeatAckSeen = false;
};
