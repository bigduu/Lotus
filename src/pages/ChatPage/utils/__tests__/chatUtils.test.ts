import { describe, it, expect } from "vitest";
import {
  buildWorkspaceGroupLabels,
  formatCalendarDateKey,
  getDateGroupKeyForChat,
  getSortedDateKeys,
  getSortedWorkspaceKeys,
  getWorkspaceBaseName,
  getWorkspaceGroupKey,
  groupChatsByDate,
  groupChatsByCalendarDate,
  groupChatsByWorkspace,
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
  NO_WORKSPACE_GROUP_KEY,
} from "../chatUtils";
import { ChatItem } from "@shared/types/chat";

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

  // ─── Secondary grouping: by workspace (Lotus #95) ────────────────────
  describe("getWorkspaceGroupKey", () => {
    it("returns the trimmed workspace path when present", () => {
      expect(getWorkspaceGroupKey("/Users/alice/zenith")).toBe("/Users/alice/zenith");
      expect(getWorkspaceGroupKey("  /Users/alice/zenith  ")).toBe("/Users/alice/zenith");
    });

    it("returns the sentinel for missing/blank paths", () => {
      expect(getWorkspaceGroupKey(null)).toBe(NO_WORKSPACE_GROUP_KEY);
      expect(getWorkspaceGroupKey(undefined)).toBe(NO_WORKSPACE_GROUP_KEY);
      expect(getWorkspaceGroupKey("")).toBe(NO_WORKSPACE_GROUP_KEY);
      expect(getWorkspaceGroupKey("   ")).toBe(NO_WORKSPACE_GROUP_KEY);
    });
  });

  describe("groupChatsByWorkspace", () => {
    it("buckets same-workspace sessions together, scattered createdAt notwithstanding", () => {
      const chats = [
        { id: "1", createdAt: 1000, config: { workspacePath: "/Users/alice/zenith" } },
        { id: "2", createdAt: 5000, config: { workspacePath: "/Users/alice/bamboo" } },
        { id: "3", createdAt: 3000, config: { workspacePath: "/Users/alice/zenith" } },
      ];

      const grouped = groupChatsByWorkspace(chats);

      expect(Object.keys(grouped).sort()).toEqual(
        ["/Users/alice/bamboo", "/Users/alice/zenith"].sort(),
      );
      expect(grouped["/Users/alice/zenith"].map((c) => c.id)).toEqual(["3", "1"]);
      expect(grouped["/Users/alice/bamboo"].map((c) => c.id)).toEqual(["2"]);
    });

    it("routes sessions with no workspacePath into the sentinel bucket", () => {
      const chats = [
        { id: "1", createdAt: 1000, config: { workspacePath: null } },
        { id: "2", createdAt: 2000, config: { workspacePath: undefined } },
        { id: "3", createdAt: 3000, config: { workspacePath: "" } },
      ];

      const grouped = groupChatsByWorkspace(chats);

      expect(Object.keys(grouped)).toEqual([NO_WORKSPACE_GROUP_KEY]);
      expect(grouped[NO_WORKSPACE_GROUP_KEY]).toHaveLength(3);
    });

    it("does NOT split pinned sessions into a separate cross-workspace bucket — they sort first within their own group instead", () => {
      const chats = [
        { id: "1", createdAt: 1000, pinned: false, config: { workspacePath: "/w/zenith" } },
        { id: "2", createdAt: 2000, pinned: true, config: { workspacePath: "/w/zenith" } },
      ];

      const grouped = groupChatsByWorkspace(chats);

      expect(Object.keys(grouped)).toEqual(["/w/zenith"]);
      // Pinned sorts first even though it's not the most recent.
      expect(grouped["/w/zenith"].map((c) => c.id)).toEqual(["2", "1"]);
    });
  });

  describe("getSortedWorkspaceKeys", () => {
    it("orders workspace groups by latest activity, most recent first", () => {
      const grouped = {
        "/w/old": [{ createdAt: 1000 }],
        "/w/new": [{ createdAt: 9000 }],
      };

      expect(getSortedWorkspaceKeys(grouped)).toEqual(["/w/new", "/w/old"]);
    });

    it("always places the no-workspace bucket last, regardless of recency", () => {
      const grouped = {
        [NO_WORKSPACE_GROUP_KEY]: [{ createdAt: 99999 }],
        "/w/zenith": [{ createdAt: 1 }],
      };

      expect(getSortedWorkspaceKeys(grouped)).toEqual(["/w/zenith", NO_WORKSPACE_GROUP_KEY]);
    });
  });

  describe("workspace calendar dates", () => {
    it("uses stable local YYYY-MM-DD keys without relocating pinned or scheduled sessions", () => {
      const createdAt = new Date(2026, 6, 18, 12).getTime();
      const grouped = groupChatsByCalendarDate([
        { id: "regular", createdAt },
        { id: "scheduled", createdAt: createdAt - 1, createdByScheduleId: "schedule-1" },
        { id: "pinned", createdAt: createdAt - 2, pinned: true },
      ]);

      expect(Object.keys(grouped)).toEqual(["2026-07-18"]);
      expect(grouped["2026-07-18"].map(({ id }) => id)).toEqual(["pinned", "scheduled", "regular"]);
    });

    it("formats a stable key using the selected Lotus locale", () => {
      expect(formatCalendarDateKey("2026-07-18", "zh-CN")).toBe("2026年7月18日");
      expect(formatCalendarDateKey("2026-07-18", "en-US")).toBe("Jul 18, 2026");
    });
  });

  describe("getWorkspaceBaseName / buildWorkspaceGroupLabels", () => {
    it("uses the last path segment as the base name", () => {
      expect(getWorkspaceBaseName("/Users/alice/Workspace/zenith")).toBe("zenith");
      expect(getWorkspaceBaseName("/Users/alice/Workspace/zenith/")).toBe("zenith");
      expect(getWorkspaceBaseName("C:\\Users\\alice\\zenith")).toBe("zenith");
    });

    it("labels non-colliding paths with their plain base name", () => {
      const labels = buildWorkspaceGroupLabels(["/Users/alice/zenith", "/Users/alice/bamboo"]);
      expect(labels).toEqual({
        "/Users/alice/zenith": "zenith",
        "/Users/alice/bamboo": "bamboo",
      });
    });

    it("disambiguates a base-name collision with the parent directory", () => {
      const labels = buildWorkspaceGroupLabels([
        "/Users/alice/zenith/bamboo",
        "/Users/alice/other/bamboo",
      ]);
      expect(labels).toEqual({
        "/Users/alice/zenith/bamboo": "zenith · bamboo",
        "/Users/alice/other/bamboo": "other · bamboo",
      });
    });
  });
});
