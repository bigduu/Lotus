import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("streamingMessageBus", () => {
  let streamingMessageBus: any;

  beforeEach(async () => {
    // Reset modules to get a fresh instance
    vi.resetModules();

    // Import fresh module
    streamingMessageBus = await import("../streamingMessageBus").then(
      (m) => m.streamingMessageBus,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("getLatest", () => {
    it("should return null for non-existent message", () => {
      const result = streamingMessageBus.getLatest("nonexistent");
      expect(result).toBeNull();
    });

    it("should return latest content after publish", () => {
      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg1",
        content: "Hello",
      });

      const result = streamingMessageBus.getLatest("msg1");
      expect(result).toBe("Hello");
    });

    it("should return null after clearing message", () => {
      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg1",
        content: "Hello",
      });

      streamingMessageBus.clear("session1", "msg1");

      const result = streamingMessageBus.getLatest("msg1");
      expect(result).toBeNull();
    });

    it("should return null after publishing null content", () => {
      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg1",
        content: "Hello",
      });

      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg1",
        content: null,
      });

      const result = streamingMessageBus.getLatest("msg1");
      expect(result).toBeNull();
    });
  });

  describe("subscribeMessage", () => {
    it("should call listener with latest content when subscribing", () => {
      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg1",
        content: "Hello",
      });

      const listener = vi.fn();
      streamingMessageBus.subscribeMessage("msg1", listener);

      expect(listener).toHaveBeenCalledWith("Hello");
    });

    it("should call listener when new content is published", async () => {
      // Stub RAF to delay execution
      vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
        setTimeout(() => cb(performance.now()), 0);
        return 1;
      });

      const listener = vi.fn();
      streamingMessageBus.subscribeMessage("msg1", listener);

      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg1",
        content: "World",
      });

      // Wait for RAF to flush
      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalledWith("World");
      });
    });

    it("should return unsubscribe function", () => {
      const listener = vi.fn();
      const unsubscribe = streamingMessageBus.subscribeMessage(
        "msg1",
        listener,
      );

      expect(typeof unsubscribe).toBe("function");
    });

    it("should remove listener when unsubscribe is called", async () => {
      vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
        setTimeout(() => cb(performance.now()), 0);
        return 1;
      });

      const listener = vi.fn();
      const unsubscribe = streamingMessageBus.subscribeMessage(
        "msg1",
        listener,
      );

      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg1",
        content: "First",
      });

      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalledTimes(1);
      });

      unsubscribe();

      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg1",
        content: "Second",
      });

      // Should still be 1 because listener was unsubscribed
      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalledTimes(1);
      });
    });

    it("should clean up empty listener sets", async () => {
      vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
        setTimeout(() => cb(performance.now()), 0);
        return 1;
      });

      const listener1 = vi.fn();
      const listener2 = vi.fn();

      const unsub1 = streamingMessageBus.subscribeMessage("msg1", listener1);
      const unsub2 = streamingMessageBus.subscribeMessage("msg1", listener2);

      unsub1();
      unsub2();

      // Both listeners removed, set should be deleted
      const listener3 = vi.fn();
      streamingMessageBus.subscribeMessage("msg1", listener3);

      // New listener should not receive previous content
      expect(listener3).not.toHaveBeenCalled();
    });

    it("should not call listener with null when no latest content", () => {
      const listener = vi.fn();
      streamingMessageBus.subscribeMessage("nonexistent", listener);

      // Should not be called if no latest content
      expect(listener).not.toHaveBeenCalled();
    });

    it("should handle multiple messages independently", async () => {
      vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
        setTimeout(() => cb(performance.now()), 0);
        return 1;
      });

      const listener1 = vi.fn();
      const listener2 = vi.fn();

      streamingMessageBus.subscribeMessage("msg1", listener1);
      streamingMessageBus.subscribeMessage("msg2", listener2);

      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg1",
        content: "Hello",
      });

      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg2",
        content: "World",
      });

      await vi.waitFor(() => {
        expect(listener1).toHaveBeenCalledWith("Hello");
        expect(listener2).toHaveBeenCalledWith("World");
      });
    });

    it("should handle multiple listeners for same message", async () => {
      vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
        setTimeout(() => cb(performance.now()), 0);
        return 1;
      });

      const listener1 = vi.fn();
      const listener2 = vi.fn();

      streamingMessageBus.subscribeMessage("msg1", listener1);
      streamingMessageBus.subscribeMessage("msg1", listener2);

      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg1",
        content: "Test",
      });

      await vi.waitFor(() => {
        expect(listener1).toHaveBeenCalledWith("Test");
        expect(listener2).toHaveBeenCalledWith("Test");
      });
    });
  });

  describe("subscribe (update listener)", () => {
    it("should call listener when message is published", async () => {
      vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
        setTimeout(() => cb(performance.now()), 0);
        return 1;
      });

      const listener = vi.fn();
      streamingMessageBus.subscribe(listener);

      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg1",
        content: "Hello",
      });

      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalledWith({
          sessionId: "session1",
          messageId: "msg1",
          content: "Hello",
        });
      });
    });

    it("should return unsubscribe function", () => {
      const listener = vi.fn();
      const unsubscribe = streamingMessageBus.subscribe(listener);

      expect(typeof unsubscribe).toBe("function");
    });

    it("should remove listener when unsubscribe is called", async () => {
      vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
        setTimeout(() => cb(performance.now()), 0);
        return 1;
      });

      const listener = vi.fn();
      const unsubscribe = streamingMessageBus.subscribe(listener);

      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg1",
        content: "First",
      });

      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalledTimes(1);
      });

      unsubscribe();

      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg2",
        content: "Second",
      });

      // Wait a bit to ensure no additional call
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should handle multiple update listeners", async () => {
      vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
        setTimeout(() => cb(performance.now()), 0);
        return 1;
      });

      const listener1 = vi.fn();
      const listener2 = vi.fn();

      streamingMessageBus.subscribe(listener1);
      streamingMessageBus.subscribe(listener2);

      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg1",
        content: "Test",
      });

      await vi.waitFor(() => {
        expect(listener1).toHaveBeenCalledTimes(1);
        expect(listener2).toHaveBeenCalledTimes(1);
      });
    });

    it("should receive null content updates", async () => {
      vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
        setTimeout(() => cb(performance.now()), 0);
        return 1;
      });

      const listener = vi.fn();
      streamingMessageBus.subscribe(listener);

      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg1",
        content: null,
      });

      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalledWith({
          sessionId: "session1",
          messageId: "msg1",
          content: null,
        });
      });
    });
  });

  describe("publish", () => {
    it("should update latestContent with non-null content", () => {
      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg1",
        content: "Hello",
      });

      const result = streamingMessageBus.getLatest("msg1");
      expect(result).toBe("Hello");
    });

    it("should delete latestContent when content is null", () => {
      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg1",
        content: "Hello",
      });

      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg1",
        content: null,
      });

      const result = streamingMessageBus.getLatest("msg1");
      expect(result).toBeNull();
    });

    it("should use requestAnimationFrame to batch updates", async () => {
      const rafSpy = vi
        .spyOn(window, "requestAnimationFrame")
        .mockImplementation((cb) => {
          setTimeout(() => cb(performance.now()), 0);
          return 1;
        });

      const listener = vi.fn();
      streamingMessageBus.subscribeMessage("msg1", listener);

      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg1",
        content: "Test",
      });

      expect(rafSpy).toHaveBeenCalled();

      rafSpy.mockRestore();
    });

    it("should batch multiple updates before RAF", async () => {
      const rafSpy = vi
        .spyOn(window, "requestAnimationFrame")
        .mockImplementation((cb) => {
          // Delay the callback to simulate batching
          setTimeout(() => cb(performance.now()), 0);
          return 1;
        });

      const listener = vi.fn();
      streamingMessageBus.subscribeMessage("msg1", listener);

      // Publish multiple times before RAF
      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg1",
        content: "First",
      });
      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg1",
        content: "Second",
      });
      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg1",
        content: "Third",
      });

      // Should only call RAF once
      expect(rafSpy).toHaveBeenCalledTimes(1);

      rafSpy.mockRestore();
    });

    it("should overwrite previous pending update for same message", () => {
      const listener = vi.fn();
      streamingMessageBus.subscribeMessage("msg1", listener);

      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg1",
        content: "First",
      });
      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg1",
        content: "Second",
      });

      // Only the second should be stored
      expect(streamingMessageBus.getLatest("msg1")).toBe("Second");
    });
  });

  describe("clear", () => {
    it("should clear latest content", () => {
      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg1",
        content: "Hello",
      });

      streamingMessageBus.clear("session1", "msg1");

      expect(streamingMessageBus.getLatest("msg1")).toBeNull();
    });

    it("should clear pending updates", async () => {
      const rafSpy = vi
        .spyOn(window, "requestAnimationFrame")
        .mockImplementation(() => 1);

      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg1",
        content: "Hello",
      });

      streamingMessageBus.clear("session1", "msg1");

      // Force flush
      const rafCallback = rafSpy.mock.calls[0]?.[0];
      if (rafCallback) {
        rafCallback(performance.now());
      }

      const result = streamingMessageBus.getLatest("msg1");
      expect(result).toBeNull();

      rafSpy.mockRestore();
    });

    it("should notify message listeners with null", async () => {
      vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
        setTimeout(() => cb(performance.now()), 0);
        return 1;
      });

      const listener = vi.fn();
      streamingMessageBus.subscribeMessage("msg1", listener);

      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg1",
        content: "Hello",
      });

      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalledWith("Hello");
      });

      streamingMessageBus.clear("session1", "msg1");

      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalledWith(null);
      });
    });

    it("should notify update listeners with null content", async () => {
      vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
        setTimeout(() => cb(performance.now()), 0);
        return 1;
      });

      const listener = vi.fn();
      streamingMessageBus.subscribe(listener);

      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg1",
        content: "Hello",
      });

      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalledWith({
          sessionId: "session1",
          messageId: "msg1",
          content: "Hello",
        });
      });

      streamingMessageBus.clear("session1", "msg1");

      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalledWith({
          sessionId: "session1",
          messageId: "msg1",
          content: null,
        });
      });
    });

    it("should handle clearing non-existent message", () => {
      expect(streamingMessageBus.getLatest("nonexistent")).toBeNull();
      streamingMessageBus.clear("session1", "nonexistent");
      expect(streamingMessageBus.getLatest("nonexistent")).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("should handle rapid subscribe/unsubscribe", () => {
      const listener = vi.fn();

      for (let i = 0; i < 10; i++) {
        const unsub = streamingMessageBus.subscribeMessage("msg1", listener);
        unsub();
      }

      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg1",
        content: "Test",
      });

      expect(listener).not.toHaveBeenCalled();
    });

    it("should handle empty string content", () => {
      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg1",
        content: "",
      });

      expect(streamingMessageBus.getLatest("msg1")).toBe("");
    });

    it("should handle very long content", () => {
      const longContent = "a".repeat(10000);
      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg1",
        content: longContent,
      });

      expect(streamingMessageBus.getLatest("msg1")).toBe(longContent);
    });

    it("should handle unicode and special characters", () => {
      const content = '你好 🌍\n\t"quote"';
      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg1",
        content: content,
      });

      expect(streamingMessageBus.getLatest("msg1")).toBe(content);
    });

    it("should handle multiple sessions", async () => {
      vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
        setTimeout(() => cb(performance.now()), 0);
        return 1;
      });

      const listener1 = vi.fn();
      const listener2 = vi.fn();

      streamingMessageBus.subscribeMessage("msg1", listener1);
      streamingMessageBus.subscribeMessage("msg2", listener2);

      streamingMessageBus.publish({
        sessionId: "session1",
        messageId: "msg1",
        content: "Session 1",
      });

      streamingMessageBus.publish({
        sessionId: "session2",
        messageId: "msg2",
        content: "Session 2",
      });

      await vi.waitFor(() => {
        expect(listener1).toHaveBeenCalledWith("Session 1");
        expect(listener2).toHaveBeenCalledWith("Session 2");
      });
    });
  });
});
