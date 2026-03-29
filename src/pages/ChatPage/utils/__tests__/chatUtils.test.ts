import { describe, it, expect } from "vitest";
import {
  getDateGroupKeyForChat,
  getSortedDateKeys,
  groupChatsByDate,
  isToday,
  isYesterday,
  isThisWeek,
  isThisMonth,
  generateChatTitle,
  getDateGroupKey,
  getDateGroupWeight,
  groupChatsByToolCategory,
  getSessionIdsByDate,
  getChatCountByDate,
} from "../chatUtils";
import { ChatItem } from "../../types/chat";

describe("chatUtils", () => {
  describe("generateChatTitle", () => {
    it("should generate title with chat number and date", () => {
      const title = generateChatTitle(5);
      expect(title).toContain("Chat 5");
      expect(title).toContain("-");
    });

    it("should include formatted date", () => {
      const title = generateChatTitle(1);
      const now = new Date();
      const expectedDate = now.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      expect(title).toBe(`Chat 1 - ${expectedDate}`);
    });
  });

  describe("getDateGroupKey", () => {
    it("should return 'Today' for today", () => {
      const today = new Date();
      expect(getDateGroupKey(today)).toBe("Today");
    });

    it("should return 'Yesterday' for yesterday", () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      expect(getDateGroupKey(yesterday)).toBe("Yesterday");
    });

    it("should return 'This Week' for dates in current week", () => {
      const thisWeek = new Date();
      thisWeek.setDate(thisWeek.getDate() - 2);
      if (!isToday(thisWeek) && !isYesterday(thisWeek) && isThisWeek(thisWeek)) {
        expect(getDateGroupKey(thisWeek)).toBe("This Week");
      }
    });

    it("should return 'This Month' for dates in current month but not this week", () => {
      const thisMonth = new Date();
      thisMonth.setDate(thisMonth.getDate() - 10);
      if (!isThisWeek(thisMonth) && isThisMonth(thisMonth)) {
        expect(getDateGroupKey(thisMonth)).toBe("This Month");
      }
    });

    it("should return month string for older dates", () => {
      const oldDate = new Date();
      oldDate.setMonth(oldDate.getMonth() - 3);
      const result = getDateGroupKey(oldDate);
      expect(result).not.toBe("Today");
      expect(result).not.toBe("Yesterday");
      expect(result).not.toBe("This Week");
      expect(result).not.toBe("This Month");
    });
  });

  describe("getDateGroupWeight", () => {
    it("should return correct weights for standard keys", () => {
      expect(getDateGroupWeight("Today")).toBe(0);
      expect(getDateGroupWeight("Yesterday")).toBe(1);
      expect(getDateGroupWeight("This Week")).toBe(2);
      expect(getDateGroupWeight("This Month")).toBe(3);
    });

    it("should return 4 for unknown keys", () => {
      expect(getDateGroupWeight("Random Key")).toBe(4);
      expect(getDateGroupWeight("March 2024")).toBe(4);
    });
  });

  describe("groupChatsByToolCategory", () => {
    it("should group chats by system prompt category", () => {
      const chats: ChatItem[] = [
        {
          id: "1",
          title: "Code Chat",
          createdAt: Date.now(),
          pinned: false,
          messages: [],
          currentInteraction: null,
          config: {
            systemPromptId: "code-assistant",
            baseSystemPrompt: "",
            lastUsedEnhancedPrompt: null,
          },
        },
        {
          id: "2",
          title: "General Chat",
          createdAt: Date.now(),
          pinned: false,
          messages: [],
          currentInteraction: null,
          config: {
            systemPromptId: undefined,
            baseSystemPrompt: "",
            lastUsedEnhancedPrompt: null,
          },
        },
      ];

      const grouped = groupChatsByToolCategory(chats);
      expect(grouped).toHaveProperty("code-assistant");
      expect(grouped).toHaveProperty("General");
    });

    it("should place pinned chats in Pinned group", () => {
      const chats: ChatItem[] = [
        {
          id: "1",
          title: "Pinned",
          createdAt: Date.now(),
          pinned: true,
          messages: [],
          currentInteraction: null,
          config: {
            systemPromptId: "code-assistant",
            baseSystemPrompt: "",
            lastUsedEnhancedPrompt: null,
          },
        },
      ];

      const grouped = groupChatsByToolCategory(chats);
      expect(grouped).toHaveProperty("Pinned");
      expect(grouped["Pinned"].length).toBe(1);
      expect(grouped["code-assistant"]).toBeUndefined();
    });

    it("should sort chats by createdAt within categories", () => {
      const chats: ChatItem[] = [
        {
          id: "2",
          title: "Later",
          createdAt: 2000,
          pinned: false,
          messages: [],
          currentInteraction: null,
          config: {
            systemPromptId: "cat1",
            baseSystemPrompt: "",
            lastUsedEnhancedPrompt: null,
          },
        },
        {
          id: "1",
          title: "Earlier",
          createdAt: 1000,
          pinned: false,
          messages: [],
          currentInteraction: null,
          config: {
            systemPromptId: "cat1",
            baseSystemPrompt: "",
            lastUsedEnhancedPrompt: null,
          },
        },
      ];

      const grouped = groupChatsByToolCategory(chats);
      expect(grouped["cat1"][0].id).toBe("2");
      expect(grouped["cat1"][1].id).toBe("1");
    });
  });

  describe("getSessionIdsByDate", () => {
    it("should return session IDs for a date group", () => {
      const grouped = {
        Today: [
          {
            id: "session1",
            title: "Chat 1",
            createdAt: Date.now(),
            pinned: false,
            messages: [],
            currentInteraction: null,
            config: {
              systemPromptId: "default",
              baseSystemPrompt: "",
              lastUsedEnhancedPrompt: null,
            },
          },
          {
            id: "session2",
            title: "Chat 2",
            createdAt: Date.now(),
            pinned: false,
            messages: [],
            currentInteraction: null,
            config: {
              systemPromptId: "default",
              baseSystemPrompt: "",
              lastUsedEnhancedPrompt: null,
            },
          },
        ],
      };

      const ids = getSessionIdsByDate(grouped, "Today");
      expect(ids).toEqual(["session1", "session2"]);
    });

    it("should return empty array for non-existent key", () => {
      const grouped = {};
      const ids = getSessionIdsByDate(grouped, "Today");
      expect(ids).toEqual([]);
    });
  });

  describe("getChatCountByDate", () => {
    it("should return count for a date group", () => {
      const grouped = {
        Today: [
          {
            id: "1",
            title: "Chat 1",
            createdAt: Date.now(),
            pinned: false,
            messages: [],
            currentInteraction: null,
            config: {
              systemPromptId: "default",
              baseSystemPrompt: "",
              lastUsedEnhancedPrompt: null,
            },
          },
          {
            id: "2",
            title: "Chat 2",
            createdAt: Date.now(),
            pinned: false,
            messages: [],
            currentInteraction: null,
            config: {
              systemPromptId: "default",
              baseSystemPrompt: "",
              lastUsedEnhancedPrompt: null,
            },
          },
        ],
      };

      expect(getChatCountByDate(grouped, "Today")).toBe(2);
    });

    it("should return 0 for non-existent key", () => {
      const grouped = {};
      expect(getChatCountByDate(grouped, "Today")).toBe(0);
    });
  });

  describe("getDateGroupKeyForChat", () => {
    it("should return 'Pinned' for pinned chats", () => {
      const chat: ChatItem = {
        id: "1",
        title: "Test Chat",
        createdAt: Date.now(),
        pinned: true,
        messages: [],
        currentInteraction: null,
        config: {
          systemPromptId: "default",
          baseSystemPrompt: "",
          lastUsedEnhancedPrompt: null,
        },
      };

      expect(getDateGroupKeyForChat(chat)).toBe("Pinned");
    });

    it("should return 'Scheduled' for scheduled chats", () => {
      const chat: ChatItem = {
        id: "1",
        title: "Scheduled Chat",
        createdAt: Date.now(),
        pinned: false,
        createdByScheduleId: "schedule-123",
        messages: [],
        currentInteraction: null,
        config: {
          systemPromptId: "default",
          baseSystemPrompt: "",
          lastUsedEnhancedPrompt: null,
        },
      };

      expect(getDateGroupKeyForChat(chat)).toBe("Scheduled");
    });

    it("should return localized date string for non-pinned chats", () => {
      const now = new Date();
      const chat: ChatItem = {
        id: "1",
        title: "Test Chat",
        createdAt: now.getTime(),
        pinned: false,
        messages: [],
        currentInteraction: null,
        config: {
          systemPromptId: "default",
          baseSystemPrompt: "",
          lastUsedEnhancedPrompt: null,
        },
      };

      const expectedDateKey = now.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });

      expect(getDateGroupKeyForChat(chat)).toBe(expectedDateKey);
    });

    it("should return consistent date keys for chats on the same day", () => {
      const now = new Date();
      const chat1: ChatItem = {
        id: "1",
        title: "Test Chat 1",
        createdAt: now.getTime(),
        pinned: false,
        messages: [],
        currentInteraction: null,
        config: {
          systemPromptId: "default",
          baseSystemPrompt: "",
          lastUsedEnhancedPrompt: null,
        },
      };

      const chat2: ChatItem = {
        id: "2",
        title: "Test Chat 2",
        createdAt: now.getTime() + 1000, // 1 second later
        pinned: false,
        messages: [],
        currentInteraction: null,
        config: {
          systemPromptId: "default",
          baseSystemPrompt: "",
          lastUsedEnhancedPrompt: null,
        },
      };

      expect(getDateGroupKeyForChat(chat1)).toBe(getDateGroupKeyForChat(chat2));
    });
  });

  describe("groupChatsByDate", () => {
    it("should group pinned chats separately", () => {
      const chats: ChatItem[] = [
        {
          id: "1",
          title: "Pinned Chat",
          createdAt: Date.now(),
          pinned: true,
          messages: [],
          currentInteraction: null,
          config: {
            systemPromptId: "default",
            baseSystemPrompt: "",
            lastUsedEnhancedPrompt: null,
          },
        },
        {
          id: "2",
          title: "Regular Chat",
          createdAt: Date.now(),
          pinned: false,
          messages: [],
          currentInteraction: null,
          config: {
            systemPromptId: "default",
            baseSystemPrompt: "",
            lastUsedEnhancedPrompt: null,
          },
        },
      ];

      const grouped = groupChatsByDate(chats);
      expect(grouped).toHaveProperty("Pinned");
      expect(grouped["Pinned"].length).toBe(1);
      expect(grouped["Pinned"][0].id).toBe("1");
    });

    it("should group scheduled chats separately", () => {
      const chats: ChatItem[] = [
        {
          id: "1",
          title: "Scheduled Chat",
          createdAt: Date.now(),
          pinned: false,
          createdByScheduleId: "schedule-1",
          messages: [],
          currentInteraction: null,
          config: {
            systemPromptId: "default",
            baseSystemPrompt: "",
            lastUsedEnhancedPrompt: null,
          },
        },
        {
          id: "2",
          title: "Regular Chat",
          createdAt: Date.now(),
          pinned: false,
          messages: [],
          currentInteraction: null,
          config: {
            systemPromptId: "default",
            baseSystemPrompt: "",
            lastUsedEnhancedPrompt: null,
          },
        },
      ];

      const grouped = groupChatsByDate(chats);
      expect(grouped).toHaveProperty("Scheduled");
      expect(grouped["Scheduled"].length).toBe(1);
      expect(grouped["Scheduled"][0].id).toBe("1");
    });

    it("should sort pinned chats by createdAt descending", () => {
      const chats: ChatItem[] = [
        {
          id: "1",
          title: "Older Pinned",
          createdAt: 1000,
          pinned: true,
          messages: [],
          currentInteraction: null,
          config: {
            systemPromptId: "default",
            baseSystemPrompt: "",
            lastUsedEnhancedPrompt: null,
          },
        },
        {
          id: "2",
          title: "Newer Pinned",
          createdAt: 2000,
          pinned: true,
          messages: [],
          currentInteraction: null,
          config: {
            systemPromptId: "default",
            baseSystemPrompt: "",
            lastUsedEnhancedPrompt: null,
          },
        },
      ];

      const grouped = groupChatsByDate(chats);
      expect(grouped["Pinned"][0].id).toBe("2");
      expect(grouped["Pinned"][1].id).toBe("1");
    });

    it("should group chats by date", () => {
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);

      const chats: ChatItem[] = [
        {
          id: "1",
          title: "Today's Chat",
          createdAt: now.getTime(),
          pinned: false,
          messages: [],
          currentInteraction: null,
          config: {
            systemPromptId: "default",
            baseSystemPrompt: "",
            lastUsedEnhancedPrompt: null,
          },
        },
        {
          id: "2",
          title: "Yesterday's Chat",
          createdAt: yesterday.getTime(),
          pinned: false,
          messages: [],
          currentInteraction: null,
          config: {
            systemPromptId: "default",
            baseSystemPrompt: "",
            lastUsedEnhancedPrompt: null,
          },
        },
      ];

      const grouped = groupChatsByDate(chats);
      const dateKeys = Object.keys(grouped);
      expect(dateKeys.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("getSortedDateKeys", () => {
    it("should keep pinned first and sort by most recent chat", () => {
      const grouped = {
        Older: [
          {
            id: "1",
            title: "Older",
            createdAt: 1000,
            pinned: false,
            messages: [],
            currentInteraction: null,
            config: {
              systemPromptId: "default",
              baseSystemPrompt: "",
              lastUsedEnhancedPrompt: null,
            },
          },
        ],
        Newer: [
          {
            id: "2",
            title: "Newer",
            createdAt: 2000,
            pinned: false,
            messages: [],
            currentInteraction: null,
            config: {
              systemPromptId: "default",
              baseSystemPrompt: "",
              lastUsedEnhancedPrompt: null,
            },
          },
        ],
        Pinned: [
          {
            id: "3",
            title: "Pinned",
            createdAt: 1500,
            pinned: true,
            messages: [],
            currentInteraction: null,
            config: {
              systemPromptId: "default",
              baseSystemPrompt: "",
              lastUsedEnhancedPrompt: null,
            },
          },
        ],
      };

      expect(getSortedDateKeys(grouped)).toEqual(["Pinned", "Newer", "Older"]);
    });

    it("should place Scheduled after Pinned", () => {
      const grouped = {
        Scheduled: [
          {
            id: "1",
            title: "Scheduled",
            createdAt: 1000,
            pinned: false,
            createdByScheduleId: "sched-1",
            messages: [],
            currentInteraction: null,
            config: {
              systemPromptId: "default",
              baseSystemPrompt: "",
              lastUsedEnhancedPrompt: null,
            },
          },
        ],
        Regular: [
          {
            id: "2",
            title: "Regular",
            createdAt: 2000,
            pinned: false,
            messages: [],
            currentInteraction: null,
            config: {
              systemPromptId: "default",
              baseSystemPrompt: "",
              lastUsedEnhancedPrompt: null,
            },
          },
        ],
      };

      const sorted = getSortedDateKeys(grouped);
      expect(sorted[0]).toBe("Scheduled");
      expect(sorted[1]).toBe("Regular");
    });

    it("should sort nested category groups by most recent chat", () => {
      const grouped = {
        "Day A": {
          Alpha: [
            {
              id: "1",
              title: "A1",
              createdAt: 1000,
              pinned: false,
              messages: [],
              currentInteraction: null,
              config: {
                systemPromptId: "default",
                baseSystemPrompt: "",
                lastUsedEnhancedPrompt: null,
              },
            },
            {
              id: "2",
              title: "A2",
              createdAt: 2500,
              pinned: false,
              messages: [],
              currentInteraction: null,
              config: {
                systemPromptId: "default",
                baseSystemPrompt: "",
                lastUsedEnhancedPrompt: null,
              },
            },
          ],
        },
        "Day B": {
          Beta: [
            {
              id: "3",
              title: "B1",
              createdAt: 2000,
              pinned: false,
              messages: [],
              currentInteraction: null,
              config: {
                systemPromptId: "default",
                baseSystemPrompt: "",
                lastUsedEnhancedPrompt: null,
              },
            },
          ],
        },
      };

      expect(getSortedDateKeys(grouped)).toEqual(["Day A", "Day B"]);
    });
  });

  describe("date utility functions", () => {
    it("isToday should correctly identify today's date", () => {
      const today = new Date();
      expect(isToday(today)).toBe(true);

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      expect(isToday(yesterday)).toBe(false);
    });

    it("isYesterday should correctly identify yesterday's date", () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      expect(isYesterday(yesterday)).toBe(true);

      const today = new Date();
      expect(isYesterday(today)).toBe(false);
    });

    it("isThisWeek should correctly identify dates in current week", () => {
      const today = new Date();
      expect(isThisWeek(today)).toBe(true);

      const lastWeek = new Date();
      lastWeek.setDate(lastWeek.getDate() - 8);
      expect(isThisWeek(lastWeek)).toBe(false);
    });

    it("isThisMonth should correctly identify dates in current month", () => {
      const today = new Date();
      expect(isThisMonth(today)).toBe(true);

      const lastMonth = new Date();
      lastMonth.setDate(1);
      lastMonth.setMonth(lastMonth.getMonth() - 1);
      expect(isThisMonth(lastMonth)).toBe(false);
    });
  });
});
