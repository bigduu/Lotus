import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getNotificationPreferences,
  setNotificationPreferences,
  clearNotificationDedupCache,
  isAppInBackground,
  buildDedupKey,
  type DesktopNotificationOptions,
} from "../desktopNotification";

const PREFS_KEY = "bodhi_notification_prefs";

describe("desktopNotification", () => {
  beforeEach(() => {
    localStorage.clear();
    clearNotificationDedupCache();
  });

  afterEach(() => {
    localStorage.clear();
    clearNotificationDedupCache();
    vi.restoreAllMocks();
  });

  describe("getNotificationPreferences", () => {
    it("returns defaults when localStorage is empty", () => {
      const prefs = getNotificationPreferences();
      expect(prefs.enabled).toBe(true);
      expect(prefs.onClarification).toBe(true);
      expect(prefs.onToolApproval).toBe(true);
      expect(prefs.onContextPressure).toBe(true);
      expect(prefs.onSubAgentComplete).toBe(false);
    });

    it("returns stored preferences", () => {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ enabled: false, onClarification: false }));
      const prefs = getNotificationPreferences();
      expect(prefs.enabled).toBe(false);
      expect(prefs.onClarification).toBe(false);
      // Other fields keep defaults
      expect(prefs.onToolApproval).toBe(true);
    });

    it("falls back to defaults on invalid JSON", () => {
      localStorage.setItem(PREFS_KEY, "not-json");
      const prefs = getNotificationPreferences();
      expect(prefs.enabled).toBe(true);
    });
  });

  describe("setNotificationPreferences", () => {
    it("merges partial updates with existing prefs", () => {
      setNotificationPreferences({ onSubAgentComplete: true });
      const prefs = getNotificationPreferences();
      expect(prefs.onSubAgentComplete).toBe(true);
      expect(prefs.enabled).toBe(true); // unchanged
    });
  });

  describe("isAppInBackground", () => {
    it("returns document.hidden value", () => {
      expect(isAppInBackground()).toBe(document.hidden);
    });
  });

  describe("buildDedupKey", () => {
    it("builds key with sessionId and eventType", () => {
      const opts: DesktopNotificationOptions = {
        title: "test",
        body: "body",
        sessionId: "sess-1",
        eventType: "clarification",
      };
      expect(buildDedupKey(opts)).toBe("sess-1::clarification");
    });

    it("builds key with eventId when provided", () => {
      const opts: DesktopNotificationOptions = {
        title: "test",
        body: "body",
        sessionId: "sess-1",
        eventType: "tool_approval",
        eventId: "tool-123",
      };
      expect(buildDedupKey(opts)).toBe("sess-1::tool_approval::tool-123");
    });

    it("uses global when sessionId is missing", () => {
      const opts: DesktopNotificationOptions = {
        title: "test",
        body: "body",
        eventType: "context_pressure",
      };
      expect(buildDedupKey(opts)).toBe("global::context_pressure");
    });
  });
});
