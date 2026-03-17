import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useAppStore, selectSessionById, selectCurrentChat, selectCurrentMessages } from "../index";
import type { ChatItem } from "../../types/chat";

describe("ChatPage Store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Reset store state to clean state
    useAppStore.setState({
      chats: [],
      currentSessionId: null,
      agentAvailability: null,
      models: [],
      selectedModel: undefined,
      modelsError: undefined,
      isLoadingModels: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("AgentAvailabilitySlice", () => {
    it("should initialize with null availability", () => {
      expect(useAppStore.getState().agentAvailability).toBe(null);
    });

    it("should set agent availability", () => {
      useAppStore.getState().setAgentAvailability(true);
      expect(useAppStore.getState().agentAvailability).toBe(true);

      useAppStore.getState().setAgentAvailability(false);
      expect(useAppStore.getState().agentAvailability).toBe(false);
    });

    it("should toggle availability states", () => {
      // Test state transitions
      useAppStore.getState().setAgentAvailability(null);
      expect(useAppStore.getState().agentAvailability).toBe(null);

      useAppStore.getState().setAgentAvailability(true);
      expect(useAppStore.getState().agentAvailability).toBe(true);

      useAppStore.getState().setAgentAvailability(false);
      expect(useAppStore.getState().agentAvailability).toBe(false);

      useAppStore.getState().setAgentAvailability(null);
      expect(useAppStore.getState().agentAvailability).toBe(null);
    });
  });

  describe("Selectors", () => {
    const mockChats: ChatItem[] = [
      {
        id: "session-1",
        title: "Chat 1",
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "session-2",
        title: "Chat 2",
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    beforeEach(() => {
      useAppStore.setState({
        chats: mockChats,
        currentSessionId: "session-1",
      });
    });

    describe("selectSessionById", () => {
      it("should select session by ID", () => {
        const selector = selectSessionById("session-1");
        const result = selector(useAppStore.getState());

        expect(result).toEqual(mockChats[0]);
      });

      it("should return null for non-existent session", () => {
        const selector = selectSessionById("non-existent");
        const result = selector(useAppStore.getState());

        expect(result).toBeNull();
      });

      it("should return null for null session ID", () => {
        const selector = selectSessionById(null);
        const result = selector(useAppStore.getState());

        expect(result).toBeNull();
      });

      it("should use cache for repeated lookups", () => {
        const selector = selectSessionById("session-1");
        const state = useAppStore.getState();

        // Call selector twice with same chats array
        const result1 = selector(state);
        const result2 = selector(state);

        expect(result1).toBe(result2);
      });

      it("should handle empty chats array", () => {
        useAppStore.setState({ chats: [] });

        const selector = selectSessionById("session-1");
        const result = selector(useAppStore.getState());

        expect(result).toBeNull();
      });

      it("should handle special characters in session ID", () => {
        const specialChat: ChatItem = {
          id: "session-@#$%-测试",
          title: "Special Chat",
          messages: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        useAppStore.setState({ chats: [specialChat] });

        const selector = selectSessionById("session-@#$%-测试");
        const result = selector(useAppStore.getState());

        expect(result).toEqual(specialChat);
      });

      it("should handle UUID session IDs", () => {
        const uuidChat: ChatItem = {
          id: "550e8400-e29b-41d4-a716-446655440000",
          title: "UUID Chat",
          messages: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        useAppStore.setState({ chats: [uuidChat] });

        const selector = selectSessionById("550e8400-e29b-41d4-a716-446655440000");
        const result = selector(useAppStore.getState());

        expect(result).toEqual(uuidChat);
      });
    });

    describe("selectCurrentChat", () => {
      it("should select current chat", () => {
        const result = selectCurrentChat(useAppStore.getState());

        expect(result).toEqual(mockChats[0]);
      });

      it("should return null when no current session", () => {
        useAppStore.setState({ currentSessionId: null });

        const result = selectCurrentChat(useAppStore.getState());

        expect(result).toBeNull();
      });

      it("should return null when current session ID not in chats", () => {
        useAppStore.setState({ currentSessionId: "non-existent" });

        const result = selectCurrentChat(useAppStore.getState());

        expect(result).toBeNull();
      });

      it("should update when currentSessionId changes", () => {
        useAppStore.setState({ currentSessionId: "session-2" });

        const result = selectCurrentChat(useAppStore.getState());

        expect(result).toEqual(mockChats[1]);
      });

      it("should handle empty chats", () => {
        useAppStore.setState({ chats: [], currentSessionId: "session-1" });

        const result = selectCurrentChat(useAppStore.getState());

        expect(result).toBeNull();
      });
    });

    describe("selectCurrentMessages", () => {
      it("should select current messages", () => {
        const messages = [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi" },
        ];

        useAppStore.setState({
          chats: [
            {
              ...mockChats[0],
              messages: messages as any,
            },
          ],
        });

        const result = selectCurrentMessages(useAppStore.getState());

        expect(result).toEqual(messages);
      });

      it("should return empty array when no current chat", () => {
        useAppStore.setState({ currentSessionId: null });

        const result = selectCurrentMessages(useAppStore.getState());

        expect(result).toEqual([]);
      });

      it("should return empty array when current chat has no messages", () => {
        useAppStore.setState({
          chats: [
            {
              ...mockChats[0],
              messages: [],
            },
          ],
        });

        const result = selectCurrentMessages(useAppStore.getState());

        expect(result).toEqual([]);
      });

      it("should handle messages with different types", () => {
        const messages = [
          { role: "user", content: "Text message" },
          { role: "assistant", content: { type: "image", data: "base64" } },
          { role: "tool", content: { result: "success" } },
        ];

        useAppStore.setState({
          chats: [
            {
              ...mockChats[0],
              messages: messages as any,
            },
          ],
        });

        const result = selectCurrentMessages(useAppStore.getState());

        expect(result).toHaveLength(3);
        expect(result[0].role).toBe("user");
        expect(result[1].role).toBe("assistant");
        expect(result[2].role).toBe("tool");
      });

      it("should handle large message arrays", () => {
        const messages = Array.from({ length: 100 }, (_, i) => ({
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Message ${i}`,
        }));

        useAppStore.setState({
          chats: [
            {
              ...mockChats[0],
              messages: messages as any,
            },
          ],
        });

        const result = selectCurrentMessages(useAppStore.getState());

        expect(result).toHaveLength(100);
        expect(result[0].content).toBe("Message 0");
        expect(result[99].content).toBe("Message 99");
      });
    });
  });

  describe("Chat Lookup Cache", () => {
    it("should efficiently lookup chats by ID", () => {
      const chats: ChatItem[] = Array.from({ length: 100 }, (_, i) => ({
        id: `chat-${i}`,
        title: `Chat ${i}`,
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));

      useAppStore.setState({ chats });

      const selector = selectSessionById("chat-50");
      const result = selector(useAppStore.getState());

      expect(result?.id).toBe("chat-50");
    });

    it("should return same cached lookup map for same chats array", () => {
      const chats: ChatItem[] = [
        {
          id: "chat-1",
          title: "Chat 1",
          messages: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      useAppStore.setState({ chats });

      const selector = selectSessionById("chat-1");
      const state = useAppStore.getState();

      // Call multiple times with same state
      selector(state);
      selector(state);
      selector(state);

      // All calls should use the same cache
      expect(selector(state)?.id).toBe("chat-1");
    });

    it("should create new cache when chats array changes", () => {
      const chats1: ChatItem[] = [
        {
          id: "chat-1",
          title: "Chat 1",
          messages: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      const chats2: ChatItem[] = [
        {
          id: "chat-2",
          title: "Chat 2",
          messages: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      useAppStore.setState({ chats: chats1 });
      const selector = selectSessionById("chat-1");
      const result1 = selector(useAppStore.getState());
      expect(result1?.id).toBe("chat-1");

      useAppStore.setState({ chats: chats2 });
      const selector2 = selectSessionById("chat-2");
      const result2 = selector2(useAppStore.getState());
      expect(result2?.id).toBe("chat-2");
    });
  });

  describe("Edge Cases", () => {
    it("should handle undefined chats", () => {
      useAppStore.setState({ chats: undefined as any });

      const result = selectCurrentChat(useAppStore.getState());
      expect(result).toBeNull();
    });

    it("should handle null currentSessionId", () => {
      useAppStore.setState({ currentSessionId: null });

      const result = selectCurrentChat(useAppStore.getState());
      expect(result).toBeNull();
    });

    it("should handle empty string currentSessionId", () => {
      useAppStore.setState({ currentSessionId: "" });

      const selector = selectSessionById("");
      const result = selector(useAppStore.getState());

      // Empty string is falsy, so should return null
      expect(result).toBeNull();
    });

    it("should handle very long chat lists", () => {
      const chats: ChatItem[] = Array.from({ length: 1000 }, (_, i) => ({
        id: `chat-${i}`,
        title: `Chat ${i}`,
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));

      useAppStore.setState({ chats, currentSessionId: "chat-999" });

      const result = selectCurrentChat(useAppStore.getState());
      expect(result?.id).toBe("chat-999");
    });

    it("should handle messages with unicode content", () => {
      const messages = [
        { role: "user", content: "你好世界 🌍" },
        { role: "assistant", content: "Hello world! 🎉" },
      ];

      useAppStore.setState({
        chats: [
          {
            id: "chat-1",
            title: "Unicode Test",
            messages: messages as any,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        currentSessionId: "chat-1",
      });

      const result = selectCurrentMessages(useAppStore.getState());
      expect(result[0].content).toBe("你好世界 🌍");
      expect(result[1].content).toBe("Hello world! 🎉");
    });

    it("should handle messages with emojis in role", () => {
      const messages = [
        { role: "user", content: "Test message" },
      ];

      useAppStore.setState({
        chats: [
          {
            id: "chat-1",
            title: "Emoji Test 🎨",
            messages: messages as any,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        currentSessionId: "chat-1",
      });

      const chat = selectCurrentChat(useAppStore.getState());
      expect(chat?.title).toBe("Emoji Test 🎨");
    });
  });

  describe("State Persistence", () => {
    it("should maintain state consistency", () => {
      const chat: ChatItem = {
        id: "test-chat",
        title: "Test Chat",
        messages: [{ role: "user", content: "test" }] as any,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      useAppStore.setState({
        chats: [chat],
        currentSessionId: "test-chat",
      });

      // Access state multiple times
      const state1 = useAppStore.getState();
      const state2 = useAppStore.getState();

      expect(state1.chats).toBe(state2.chats);
      expect(state1.currentSessionId).toBe(state2.currentSessionId);
    });

    it("should handle rapid state updates", () => {
      const chat1: ChatItem = {
        id: "chat-1",
        title: "Chat 1",
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const chat2: ChatItem = {
        id: "chat-2",
        title: "Chat 2",
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Rapid state updates
      for (let i = 0; i < 10; i++) {
        useAppStore.setState({
          chats: i % 2 === 0 ? [chat1] : [chat2],
          currentSessionId: i % 2 === 0 ? "chat-1" : "chat-2",
        });
      }

      // Final state should be chat2
      const currentChat = selectCurrentChat(useAppStore.getState());
      expect(currentChat?.id).toBe("chat-2");
    });
  });
});
