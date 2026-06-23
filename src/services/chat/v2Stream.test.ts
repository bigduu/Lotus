import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AccountStreamHandlers,
  AgentEvent,
  AgentEventHandlers,
  ChangeEvent,
} from "./AgentService";

// Stable WS URL so the client does not depend on the real backend derivation.
vi.mock("@shared/utils/backendBaseUrl", () => ({
  getV2StreamUrl: () => "ws://127.0.0.1:9562/v2/stream",
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
  sent: string[] = [];
  url: string;

  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    sockets.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }

  // Test driver helpers.
  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  emit(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent);
  }

  emitRaw(data: string): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  drop(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  parsedSent(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
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
});
