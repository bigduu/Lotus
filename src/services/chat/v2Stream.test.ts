import { decode as msgpackDecode, encode as msgpackEncode } from "@msgpack/msgpack";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AccountStreamHandlers,
  AgentEvent,
  AgentEventHandlers,
  ChangeEvent,
} from "./AgentService";
import {
  clearDeviceCredential,
  getDeviceCredential,
  setDeviceCredential,
} from "@shared/utils/deviceAuth";

// Stable WS URL so the client does not depend on the real backend derivation.
vi.mock("@shared/utils/backendBaseUrl", () => ({
  getV2StreamUrl: () => "ws://127.0.0.1:9562/v2/stream",
}));

// Controllable msgpack flag (default OFF → JSON, matching production default).
let msgpackFlag = false;
const setMsgpackFlag = (on: boolean): void => {
  msgpackFlag = on;
};
vi.mock("@shared/utils/debugFlags", () => ({
  debugLog: () => {},
  isApiV2MsgpackEnabled: () => msgpackFlag,
}));

import {
  __resetV2StreamForTests,
  subscribeAgent,
  subscribeFeed,
  type AgentEventDispatch,
} from "./v2Stream";

// --- Mock WebSocket --------------------------------------------------------

const sockets: MockWebSocket[] = [];

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  sent: Array<string | ArrayBuffer | Uint8Array> = [];
  url: string;
  /** Subprotocols the client offered via the constructor (msgpack negotiation). */
  offeredProtocols: string[];
  /** Subprotocol the "server" echoed on the handshake; drives ws.protocol. */
  protocol = "";
  binaryType = "blob";

  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.offeredProtocols =
      protocols === undefined ? [] : Array.isArray(protocols) ? protocols : [protocols];
    sockets.push(this);
  }

  send(data: string | ArrayBuffer | Uint8Array): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }

  // Test driver helpers.
  /** Open the socket; pass the negotiated subprotocol the "server" echoed. */
  open(negotiatedProtocol = ""): void {
    this.protocol = negotiatedProtocol;
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  emit(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent);
  }

  /** Deliver an inbound msgpack-encoded envelope as an ArrayBuffer frame. */
  emitBinary(frame: unknown): void {
    const bytes = msgpackEncode(frame);
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    this.onmessage?.({ data: buf } as MessageEvent);
  }

  emitRaw(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  drop(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  parsedSent(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s as string) as Record<string, unknown>);
  }

  /** Decode outbound frames as msgpack (asserts the binary encode path). */
  msgpackSent(): Array<Record<string, unknown>> {
    return this.sent.map((s) => {
      const bytes = s instanceof ArrayBuffer ? new Uint8Array(s) : (s as Uint8Array);
      return msgpackDecode(bytes) as Record<string, unknown>;
    });
  }
}

const lastSocket = (): MockWebSocket => sockets[sockets.length - 1]!;

const change = (seq: number): ChangeEvent => ({
  seq,
  ts: "2026-06-24T00:00:00Z",
  session_id: "s1",
  event: { type: "message_appended", session_id: "s1" },
});

// A dispatch that simply forwards to a single handler key for assertion.
const tokenDispatch: AgentEventDispatch = (event: AgentEvent, handlers: AgentEventHandlers) => {
  if (event.type === "token") handlers.onToken?.(event.content || "");
};

describe("v2Stream WebSocket client", () => {
  beforeEach(() => {
    sockets.length = 0;
    setMsgpackFlag(false);
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    __resetV2StreamForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends hello + feed subscribe on open", () => {
    subscribeFeed({ onChange: vi.fn() }, 5);
    expect(sockets).toHaveLength(1);

    lastSocket().open();

    const frames = lastSocket().parsedSent();
    expect(frames[0]).toEqual({ type: "hello" });
    expect(frames).toContainEqual({ type: "subscribe", ch: "feed", since: 5 });
  });

  it("routes a feed event envelope to onChange with the full ChangeEvent", () => {
    const onChange = vi.fn();
    subscribeFeed({ onChange }, 0);
    lastSocket().open();

    const ev = change(7);
    lastSocket().emit({ ch: "feed", seq: 7, event: ev });

    expect(onChange).toHaveBeenCalledWith(ev);
  });

  it("routes a feed_reset control to onReset and resets the cursor", () => {
    const onReset = vi.fn();
    const onChange = vi.fn();
    subscribeFeed({ onChange, onReset }, 42);
    lastSocket().open();
    lastSocket().sent.length = 0;

    lastSocket().emit({ ch: "feed", seq: 0, control: { type: "feed_reset", from_seq: 42 } });
    expect(onReset).toHaveBeenCalledTimes(1);

    // After a reset the cursor drops to 0; a reconnect should re-subscribe at 0.
    vi.useFakeTimers();
    const dropped = lastSocket();
    dropped.drop();
    vi.runOnlyPendingTimers(); // fire the backoff timer -> new connect
    vi.useRealTimers();
    const next = lastSocket();
    expect(next).not.toBe(dropped);
    next.open();
    expect(next.parsedSent()).toContainEqual({ type: "subscribe", ch: "feed", since: 0 });
  });

  it("fires onOpen on connect and onError on close", () => {
    const onOpen = vi.fn();
    const onError = vi.fn();
    subscribeFeed({ onChange: vi.fn(), onOpen, onError }, 0);

    lastSocket().open();
    expect(onOpen).toHaveBeenCalledTimes(1);

    lastSocket().drop();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("dispatches an agent event envelope through the injected dispatch", () => {
    const onToken = vi.fn();
    subscribeAgent("s1", { onToken }, tokenDispatch);
    lastSocket().open();

    expect(lastSocket().parsedSent()).toContainEqual({ type: "subscribe", ch: "agent.s1" });

    lastSocket().emit({ ch: "agent.s1", seq: 1, event: { type: "token", content: "hi" } });
    expect(onToken).toHaveBeenCalledWith("hi");
  });

  it("resolves the agent subscribe promise on a terminal control", async () => {
    const { promise } = subscribeAgent("s1", {}, tokenDispatch);
    lastSocket().open();

    lastSocket().emit({ ch: "agent.s1", seq: 2, control: { type: "terminal" } });

    await expect(promise).resolves.toBeUndefined();
  });

  it("re-subscribes all live channels with the latest cursor on reconnect", () => {
    subscribeFeed({ onChange: vi.fn() }, 0);
    subscribeAgent("s1", {}, tokenDispatch);
    const first = lastSocket();
    first.open();

    // Advance the feed cursor via incoming events.
    first.emit({ ch: "feed", seq: 11, event: change(11) });

    // Drop the socket -> reconnect path (bounded backoff timer).
    vi.useFakeTimers();
    first.drop();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    const second = lastSocket();
    expect(second).not.toBe(first);
    second.open();

    const frames = second.parsedSent();
    expect(frames[0]).toEqual({ type: "hello" });
    expect(frames).toContainEqual({ type: "subscribe", ch: "feed", since: 11 });
    expect(frames).toContainEqual({ type: "subscribe", ch: "agent.s1" });
  });

  it("ignores malformed and unknown frames without throwing", () => {
    const onChange = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    subscribeFeed({ onChange }, 0);
    lastSocket().open();

    expect(() => lastSocket().emitRaw("{not json")).not.toThrow();
    expect(() => lastSocket().emit({ ch: "unknown.channel", seq: 1, event: {} })).not.toThrow();
    expect(() => lastSocket().emit({ seq: 1, event: {} })).not.toThrow();
    expect(onChange).not.toHaveBeenCalled();

    warn.mockRestore();
  });

  it("stops delivery and unsubscribes after close()", () => {
    const onChange = vi.fn();
    const handle = subscribeFeed({ onChange }, 0);
    lastSocket().open();
    lastSocket().sent.length = 0;

    handle.close();
    expect(lastSocket().parsedSent()).toContainEqual({ type: "unsubscribe", ch: "feed" });

    lastSocket().emit({ ch: "feed", seq: 1, event: change(1) });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shares one socket across feed + agent and closes it when all unsubscribe", () => {
    const feed = subscribeFeed({ onChange: vi.fn() }, 0);
    const agent = subscribeAgent("s1", {}, tokenDispatch);
    lastSocket().open();
    expect(sockets).toHaveLength(1);

    const sock = lastSocket();
    const closeSpy = vi.spyOn(sock, "close");

    feed.close();
    expect(closeSpy).not.toHaveBeenCalled(); // agent still live
    agent.close();
    expect(closeSpy).toHaveBeenCalled();
  });

  // Keep the AccountStreamHandlers shape honest for the feed path.
  it("matches the AccountStreamHandlers contract", () => {
    const handlers: AccountStreamHandlers = { onChange: vi.fn() };
    expect(typeof handlers.onChange).toBe("function");
  });

  describe("MessagePack subprotocol (opt-in)", () => {
    it("flag OFF (default): constructed WITHOUT a protocols arg, JSON both ways", () => {
      const onChange = vi.fn();
      subscribeFeed({ onChange }, 5);

      const ws = lastSocket();
      expect(ws.offeredProtocols).toEqual([]);
      ws.open();

      // Outbound is JSON text — no binary frames.
      expect(ws.sent.every((s) => typeof s === "string")).toBe(true);
      expect(ws.parsedSent()).toContainEqual({ type: "subscribe", ch: "feed", since: 5 });

      // Inbound JSON routes as before.
      const ev = change(7);
      ws.emit({ ch: "feed", seq: 7, event: ev });
      expect(onChange).toHaveBeenCalledWith(ev);
    });

    it("flag ON: offers bamboo.v2.msgpack and sets binaryType=arraybuffer", () => {
      setMsgpackFlag(true);
      subscribeFeed({ onChange: vi.fn() }, 0);

      const ws = lastSocket();
      expect(ws.offeredProtocols).toEqual(["bamboo.v2.msgpack"]);
      expect(ws.binaryType).toBe("arraybuffer");
    });

    it("negotiated msgpack: outbound frames are msgpack binary; inbound binary routes", () => {
      setMsgpackFlag(true);
      const onChange = vi.fn();
      subscribeFeed({ onChange }, 5);

      const ws = lastSocket();
      // Server echoes the subprotocol → encoding becomes msgpack post-open.
      ws.open("bamboo.v2.msgpack");

      // Outbound: all binary, decodable as msgpack, correct subscribe shape.
      expect(ws.sent.length).toBeGreaterThan(0);
      expect(ws.sent.every((s) => typeof s !== "string")).toBe(true);
      const frames = ws.msgpackSent();
      expect(frames[0]).toEqual({ type: "hello" });
      expect(frames).toContainEqual({ type: "subscribe", ch: "feed", since: 5 });

      // Inbound: a binary msgpack envelope is decoded + routed to onChange.
      const ev = change(9);
      ws.emitBinary({ ch: "feed", seq: 9, event: ev });
      expect(onChange).toHaveBeenCalledWith(ev);
    });

    it("negotiated msgpack: an inbound binary agent envelope dispatches", () => {
      setMsgpackFlag(true);
      const onToken = vi.fn();
      subscribeAgent("s1", { onToken }, tokenDispatch);

      const ws = lastSocket();
      ws.open("bamboo.v2.msgpack");
      expect(ws.msgpackSent()).toContainEqual({ type: "subscribe", ch: "agent.s1" });

      ws.emitBinary({ ch: "agent.s1", seq: 1, event: { type: "token", content: "hi" } });
      expect(onToken).toHaveBeenCalledWith("hi");
    });

    it("offered msgpack but server does NOT echo it: stays on JSON (old-backend safe)", () => {
      setMsgpackFlag(true);
      const onChange = vi.fn();
      subscribeFeed({ onChange }, 3);

      const ws = lastSocket();
      expect(ws.offeredProtocols).toEqual(["bamboo.v2.msgpack"]);
      // Empty protocol echo → ws.protocol === "" → client decodes/encodes JSON.
      ws.open("");

      // Outbound stays JSON text despite the offer.
      expect(ws.sent.every((s) => typeof s === "string")).toBe(true);
      expect(ws.parsedSent()).toContainEqual({ type: "subscribe", ch: "feed", since: 3 });

      // A JSON text envelope still routes correctly.
      const ev = change(4);
      ws.emit({ ch: "feed", seq: 4, event: ev });
      expect(onChange).toHaveBeenCalledWith(ev);
    });

    it("ignores a malformed binary frame without throwing", () => {
      setMsgpackFlag(true);
      const onChange = vi.fn();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      subscribeFeed({ onChange }, 0);

      const ws = lastSocket();
      ws.open("bamboo.v2.msgpack");

      // Truncated / non-msgpack bytes → decode throws internally, swallowed.
      const garbage = new Uint8Array([0xc1, 0xff, 0xff, 0xff]).buffer;
      expect(() => ws.emitRaw(garbage)).not.toThrow();
      expect(onChange).not.toHaveBeenCalled();

      warn.mockRestore();
    });
  });

  describe("liveness watchdog (lotus#87 / bamboo#533)", () => {
    const keepalive = { ch: "sys", seq: 0, control: { type: "keepalive" } };

    it("consumes sys keepalive frames silently (no handler calls)", () => {
      const onChange = vi.fn();
      const onError = vi.fn();
      subscribeFeed({ onChange, onError }, 0);
      lastSocket().open();

      expect(() => lastSocket().emit(keepalive)).not.toThrow();
      expect(onChange).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });

    it("force-reconnects a socket that goes silent after the backend advertised keepalives", () => {
      vi.useFakeTimers();
      const onChange = vi.fn();
      const onError = vi.fn();
      subscribeFeed({ onChange, onError }, 3);

      const first = lastSocket();
      first.open();
      // The backend proves keepalive support → the watchdog ARMS.
      first.emit(keepalive);

      // Silence past the stale threshold (45s) + one watchdog tick.
      vi.advanceTimersByTime(56_000);

      // The stale socket was torn down and a reconnect scheduled...
      expect(onError).toHaveBeenCalled();
      expect(first.readyState).toBe(MockWebSocket.CLOSED);
      // ...which, after the backoff, opens a NEW socket and re-subscribes
      // with the latest cursor — the replayed frames settle any stale UI.
      vi.advanceTimersByTime(1_000);
      expect(sockets).toHaveLength(2);
      const second = lastSocket();
      second.open();
      expect(second.parsedSent()).toContainEqual({ type: "subscribe", ch: "feed", since: 3 });

      vi.useRealTimers();
    });

    it("never fires against a backend that sends no keepalives (old backend, quiet is legitimate)", () => {
      vi.useFakeTimers();
      const onError = vi.fn();
      subscribeFeed({ onChange: vi.fn(), onError }, 0);

      const ws = lastSocket();
      ws.open();
      // NO sys keepalive ever arrives; a long quiet stretch must not reconnect.
      vi.advanceTimersByTime(10 * 60_000);

      expect(sockets).toHaveLength(1);
      expect(ws.readyState).toBe(MockWebSocket.OPEN);
      expect(onError).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it("any inbound frame resets the staleness clock, not just keepalives", () => {
      vi.useFakeTimers();
      const onChange = vi.fn();
      const onError = vi.fn();
      subscribeFeed({ onChange, onError }, 0);

      const ws = lastSocket();
      ws.open();
      ws.emit(keepalive); // arm

      // Business frames keep arriving every 30s with no further keepalives —
      // the socket is demonstrably alive, so the watchdog must stay quiet.
      for (let i = 1; i <= 6; i += 1) {
        vi.advanceTimersByTime(30_000);
        ws.emit({ ch: "feed", seq: i, event: change(i) });
      }

      expect(sockets).toHaveLength(1);
      expect(ws.readyState).toBe(MockWebSocket.OPEN);
      expect(onError).not.toHaveBeenCalled();
      expect(onChange).toHaveBeenCalledTimes(6);

      vi.useRealTimers();
    });

    it("adapts to the 2s production cadence: dead socket detected in ~6-7s", () => {
      vi.useFakeTimers();
      const onError = vi.fn();
      subscribeFeed({ onChange: vi.fn(), onError }, 0);

      const ws = lastSocket();
      ws.open();
      // Two keepalives 2s apart → observed cadence 2s → threshold clamps to
      // the 6s floor (3×2s).
      ws.emit(keepalive);
      vi.advanceTimersByTime(2_000);
      ws.emit(keepalive);

      // 5s of silence: below the floor → still connected.
      vi.advanceTimersByTime(5_000);
      expect(ws.readyState).toBe(MockWebSocket.OPEN);

      // Past 6s (+ a tick): the stale socket is torn down.
      vi.advanceTimersByTime(3_000);
      expect(ws.readyState).toBe(MockWebSocket.CLOSED);
      expect(onError).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it("back-to-back keepalives cannot tighten the threshold below the 6s floor", () => {
      vi.useFakeTimers();
      const onError = vi.fn();
      subscribeFeed({ onChange: vi.fn(), onError }, 0);

      const ws = lastSocket();
      ws.open();
      // A burst right after unblock: gaps of ~100ms. 3×0.1s = 0.3s must NOT
      // become the threshold — the floor holds at 6s.
      ws.emit(keepalive);
      vi.advanceTimersByTime(100);
      ws.emit(keepalive);
      vi.advanceTimersByTime(100);
      ws.emit(keepalive);

      // 5s of silence: within the floor → still connected, no false positive.
      vi.advanceTimersByTime(5_000);
      expect(ws.readyState).toBe(MockWebSocket.OPEN);
      expect(onError).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it("adapts the stale threshold to a fast keepalive cadence (~15s detection at 5s cadence)", () => {
      vi.useFakeTimers();
      const onError = vi.fn();
      subscribeFeed({ onChange: vi.fn(), onError }, 0);

      const ws = lastSocket();
      ws.open();
      // Two keepalives 5s apart → observed cadence 5s → threshold 15s.
      ws.emit(keepalive);
      vi.advanceTimersByTime(5_000);
      ws.emit(keepalive);

      // 10s of silence: below the adaptive threshold → still connected.
      vi.advanceTimersByTime(10_000);
      expect(ws.readyState).toBe(MockWebSocket.OPEN);

      // Past 15s of silence (+ a tick): the stale socket is torn down.
      vi.advanceTimersByTime(7_000);
      expect(ws.readyState).toBe(MockWebSocket.CLOSED);
      expect(onError).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it("keeps the conservative 45s threshold against an old 15s-cadence backend (no false positives)", () => {
      vi.useFakeTimers();
      const onError = vi.fn();
      subscribeFeed({ onChange: vi.fn(), onError }, 0);

      const ws = lastSocket();
      ws.open();
      // Old-server cadence: keepalives every 15s → threshold stays at the 45s
      // ceiling. Silence WITHIN 45s must never force-reconnect.
      ws.emit(keepalive);
      vi.advanceTimersByTime(15_000);
      ws.emit(keepalive);
      vi.advanceTimersByTime(15_000);
      ws.emit(keepalive);

      // 40s of silence: under the ceiling → still connected.
      vi.advanceTimersByTime(40_000);
      expect(ws.readyState).toBe(MockWebSocket.OPEN);
      expect(onError).not.toHaveBeenCalled();

      // Past 45s: genuinely dead → reconnect.
      vi.advanceTimersByTime(7_000);
      expect(ws.readyState).toBe(MockWebSocket.CLOSED);

      vi.useRealTimers();
    });

    it("detects a seq hole on an agent channel and reports it as a gap (#98)", () => {
      const onStreamGap = vi.fn();
      const onToken = vi.fn();
      subscribeFeed({ onChange: vi.fn() }, 0);
      void subscribeAgent("s1", { onStreamGap, onToken }, tokenDispatch);
      lastSocket().open();

      const ws = lastSocket();
      ws.emit({ ch: "agent.s1", seq: 1, event: { type: "token", content: "a" } });
      ws.emit({ ch: "agent.s1", seq: 2, event: { type: "token", content: "b" } });
      expect(onStreamGap).not.toHaveBeenCalled();

      // seq 3 and 4 never arrive → hole of 2. The frame itself still dispatches.
      ws.emit({ ch: "agent.s1", seq: 5, event: { type: "token", content: "e" } });
      expect(onStreamGap).toHaveBeenCalledWith(2);
      expect(onToken).toHaveBeenLastCalledWith("e");
    });

    it("a forwarder restart (seq back to 1) is never misread as a gap", () => {
      const onStreamGap = vi.fn();
      subscribeFeed({ onChange: vi.fn() }, 0);
      void subscribeAgent("s1", { onStreamGap }, tokenDispatch);
      lastSocket().open();

      const ws = lastSocket();
      ws.emit({ ch: "agent.s1", seq: 1, event: { type: "token", content: "a" } });
      ws.emit({ ch: "agent.s1", seq: 2, event: { type: "token", content: "b" } });
      // Server-side re-subscribe: a NEW forwarder restarts at 1, then counts up.
      ws.emit({ ch: "agent.s1", seq: 1, event: { type: "token", content: "a2" } });
      ws.emit({ ch: "agent.s1", seq: 2, event: { type: "token", content: "b2" } });
      ws.emit({ ch: "agent.s1", seq: 3, event: { type: "token", content: "c2" } });
      expect(onStreamGap).not.toHaveBeenCalled();
    });

    it("reconnect resets seq tracking: the new connection's seq 1 is not a gap", () => {
      vi.useFakeTimers();
      const onStreamGap = vi.fn();
      subscribeFeed({ onChange: vi.fn() }, 0);
      void subscribeAgent("s1", { onStreamGap }, tokenDispatch);

      const first = lastSocket();
      first.open();
      first.emit({ ch: "agent.s1", seq: 1, event: { type: "token", content: "a" } });
      first.emit({ ch: "agent.s1", seq: 2, event: { type: "token", content: "b" } });

      first.drop();
      vi.advanceTimersByTime(1_000);
      const second = lastSocket();
      second.open();
      second.emit({ ch: "agent.s1", seq: 1, event: { type: "token", content: "a2" } });
      expect(onStreamGap).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it("control frames participate in seq continuity (a declared gap control never double-fires)", () => {
      const onStreamGap = vi.fn();
      subscribeFeed({ onChange: vi.fn() }, 0);
      void subscribeAgent("s1", { onStreamGap }, tokenDispatch);
      lastSocket().open();

      const ws = lastSocket();
      ws.emit({ ch: "agent.s1", seq: 1, event: { type: "token", content: "a" } });
      // The server-declared gap control mints the NEXT seq (2): contiguous, so
      // only the DECLARED gap fires — the continuity check stays quiet.
      ws.emit({ ch: "agent.s1", seq: 2, control: { type: "gap", skipped: 7 } });
      expect(onStreamGap).toHaveBeenCalledTimes(1);
      expect(onStreamGap).toHaveBeenCalledWith(7);
    });

    it("routes an agent gap control to onStreamGap with the skipped count", async () => {
      const onStreamGap = vi.fn();
      subscribeFeed({ onChange: vi.fn() }, 0);
      void subscribeAgent("s1", { onStreamGap }, tokenDispatch);
      lastSocket().open();

      lastSocket().emit({ ch: "agent.s1", seq: 5, control: { type: "gap", skipped: 123 } });
      expect(onStreamGap).toHaveBeenCalledWith(123);

      // A gap control must NOT resolve the subscription (the channel is live).
      lastSocket().emit({ ch: "agent.s1", seq: 6, event: { type: "token", content: "hi" } });
    });

    it("the watchdog re-arms per connection: the NEW socket needs its own keepalive", () => {
      vi.useFakeTimers();
      subscribeFeed({ onChange: vi.fn() }, 0);

      const first = lastSocket();
      first.open();
      first.emit(keepalive);
      vi.advanceTimersByTime(56_000); // stale → force reconnect
      vi.advanceTimersByTime(1_000); // backoff elapses
      expect(sockets).toHaveLength(2);

      const second = lastSocket();
      second.open();
      // The new connection has NOT advertised keepalives; silence is fine.
      vi.advanceTimersByTime(10 * 60_000);
      expect(sockets).toHaveLength(2);
      expect(second.readyState).toBe(MockWebSocket.OPEN);

      vi.useRealTimers();
    });
  });
});

// v2-P2 (#181/#189; epic #26 phase 1): the hello frame carries a paired
// device credential ONLY when one is stored — additive, no-op-by-default.
// These tests don't touch reconnect/watchdog/gap logic itself, just what
// `resubscribeAll` puts in the hello frame on (re)connect.
describe("v2Stream WebSocket client — device-credential hello frame (epic #26 phase 1)", () => {
  beforeEach(() => {
    sockets.length = 0;
    setMsgpackFlag(false);
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    __resetV2StreamForTests();
    clearDeviceCredential();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends the identical no-op hello frame when no device credential is stored", () => {
    expect(getDeviceCredential()).toBeNull(); // sanity: nothing stored

    subscribeFeed({ onChange: vi.fn() }, 0);
    lastSocket().open();

    const frames = lastSocket().parsedSent();
    expect(frames[0]).toEqual({ type: "hello" });
    // No extra keys beyond "type" — byte-for-byte identical to today's frame.
    expect(Object.keys(frames[0] as object)).toEqual(["type"]);
  });

  it("includes device_id/token in the hello frame when a credential is stored", () => {
    setDeviceCredential({ device_id: "bamboo_abc123", token: "bd1_deadbeef" });

    subscribeFeed({ onChange: vi.fn() }, 0);
    lastSocket().open();

    const frames = lastSocket().parsedSent();
    expect(frames[0]).toEqual({
      type: "hello",
      device_id: "bamboo_abc123",
      token: "bd1_deadbeef",
    });
  });

  it("re-sends the stored credential's hello frame on every reconnect", () => {
    setDeviceCredential({ device_id: "bamboo_abc123", token: "bd1_deadbeef" });
    vi.useFakeTimers();

    subscribeFeed({ onChange: vi.fn() }, 0);
    const first = lastSocket();
    first.open();
    expect(first.parsedSent()[0]).toEqual({
      type: "hello",
      device_id: "bamboo_abc123",
      token: "bd1_deadbeef",
    });

    first.drop();
    vi.runOnlyPendingTimers(); // fire the backoff timer -> new connect
    vi.useRealTimers();

    const second = lastSocket();
    expect(second).not.toBe(first);
    second.open();
    expect(second.parsedSent()[0]).toEqual({
      type: "hello",
      device_id: "bamboo_abc123",
      token: "bd1_deadbeef",
    });
  });
});
