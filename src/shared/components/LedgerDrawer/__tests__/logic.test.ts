import { describe, expect, it } from "vitest";

import type { AgendaItem, AgendaSnapshot, LedgerRecord } from "@services/ledger/LedgerService";
import {
  agendaBadgeCount,
  agendaItemToListItem,
  buildEditUpsert,
  buildQuickAddRequest,
  formatAgendaTime,
  isTerminalStatus,
  listItemToEditValues,
  parseTagsInput,
  recordToListItem,
  type LedgerEditFormValues,
} from "../logic";

const baseAgendaItem: AgendaItem = {
  id: "rec-1",
  scope: "global",
  kind: "todo",
  title: "Pay rent",
  status: "open",
  priority: "high",
};

function snapshot(partial: Partial<AgendaSnapshot>): AgendaSnapshot {
  return {
    generated_at: "2026-07-13T08:00:00Z",
    overdue: [],
    today: [],
    upcoming: [],
    undated: [],
    ...partial,
  };
}

describe("ledger drawer logic", () => {
  describe("isTerminalStatus", () => {
    it("marks done/cancelled/expired as terminal", () => {
      expect(isTerminalStatus("done")).toBe(true);
      expect(isTerminalStatus("cancelled")).toBe(true);
      expect(isTerminalStatus("expired")).toBe(true);
      expect(isTerminalStatus("open")).toBe(false);
      expect(isTerminalStatus("in_progress")).toBe(false);
      expect(isTerminalStatus("blocked")).toBe(false);
    });
  });

  describe("agendaBadgeCount", () => {
    it("counts overdue + today only", () => {
      const count = agendaBadgeCount(
        snapshot({
          overdue: [baseAgendaItem, { ...baseAgendaItem, id: "rec-2" }],
          today: [{ ...baseAgendaItem, id: "rec-3" }],
          upcoming: [{ ...baseAgendaItem, id: "rec-4" }],
          undated: [{ ...baseAgendaItem, id: "rec-5" }],
        }),
      );
      expect(count).toBe(3);
    });

    it("returns 0 for a missing snapshot", () => {
      expect(agendaBadgeCount(null)).toBe(0);
      expect(agendaBadgeCount(undefined)).toBe(0);
    });
  });

  describe("formatAgendaTime", () => {
    const now = new Date("2026-07-13T10:00:00");

    it("returns empty for missing values", () => {
      expect(formatAgendaTime(undefined, now)).toBe("");
    });

    it("shows time-only for today", () => {
      expect(formatAgendaTime("2026-07-13T18:30:00", now)).toBe("18:30");
    });

    it("shows month and day within the current year", () => {
      expect(formatAgendaTime("2026-09-01T09:15:00", now)).toBe("Sep 1, 09:15");
    });

    it("shows a full date for other years", () => {
      expect(formatAgendaTime("2027-01-05T08:00:00", now)).toBe("2027-01-05 08:00");
    });

    it("falls back to the raw string when unparsable", () => {
      expect(formatAgendaTime("not-a-date", now)).toBe("not-a-date");
    });
  });

  describe("parseTagsInput", () => {
    it("splits, trims, and dedupes comma-separated tags", () => {
      expect(parseTagsInput(" home , errands ,home,, ")).toEqual(["home", "errands"]);
    });

    it("returns an empty array for blank input", () => {
      expect(parseTagsInput("")).toEqual([]);
      expect(parseTagsInput(undefined)).toEqual([]);
    });
  });

  describe("list item mapping", () => {
    it("maps agenda items, preferring due_at over anchor_at", () => {
      const item = agendaItemToListItem({
        ...baseAgendaItem,
        project_key: "proj-1",
        scope: "project",
        anchor_at: "2026-07-13T08:00:00Z",
        due_at: "2026-07-14T08:00:00Z",
      });
      expect(item).toMatchObject({
        id: "rec-1",
        title: "Pay rent",
        project_key: "proj-1",
        timeAt: "2026-07-14T08:00:00Z",
        hasDetails: false,
      });
    });

    it("maps full records including tags", () => {
      const record: LedgerRecord = {
        id: "rec-9",
        kind: "reminder",
        title: "Water plants",
        status: "open",
        priority: "low",
        scope: "global",
        time: { due_at: "2026-07-15" },
        tags: ["home"],
        created_at: "2026-07-01T00:00:00Z",
        updated_at: "2026-07-01T00:00:00Z",
      };
      const item = recordToListItem(record);
      expect(item).toMatchObject({
        id: "rec-9",
        kind: "reminder",
        timeAt: "2026-07-15",
        tags: ["home"],
        hasDetails: true,
      });
    });
  });

  describe("buildQuickAddRequest", () => {
    it("builds a todo upsert with a due date", () => {
      expect(buildQuickAddRequest("  Buy milk  ", "2026-07-14")).toEqual({
        kind: "todo",
        title: "Buy milk",
        due_at: "2026-07-14",
      });
    });

    it("omits due_at when blank", () => {
      expect(buildQuickAddRequest("Buy milk", "  ")).toEqual({
        kind: "todo",
        title: "Buy milk",
      });
    });

    it("returns null for an empty title", () => {
      expect(buildQuickAddRequest("   ")).toBeNull();
    });
  });

  describe("buildEditUpsert", () => {
    const initial: LedgerEditFormValues = {
      title: "Pay rent",
      kind: "todo",
      priority: "high",
      due_at: "2026-07-14T08:00:00Z",
      tags: "home",
      body: "",
    };

    it("returns null when nothing changed", () => {
      expect(buildEditUpsert("rec-1", initial, { ...initial })).toBeNull();
    });

    it("includes only changed fields", () => {
      const req = buildEditUpsert("rec-1", initial, {
        ...initial,
        title: "Pay rent (July)",
        priority: "critical",
      });
      expect(req).toEqual({
        id: "rec-1",
        title: "Pay rent (July)",
        priority: "critical",
      });
    });

    it("does not clobber untouched tags/body from a compact agenda item", () => {
      const compactInitial: LedgerEditFormValues = { ...initial, tags: "", body: "" };
      const req = buildEditUpsert("rec-1", compactInitial, {
        ...compactInitial,
        kind: "reminder",
      });
      expect(req).toEqual({ id: "rec-1", kind: "reminder" });
    });

    it("supports clearing tags when they were present initially", () => {
      const req = buildEditUpsert("rec-1", initial, { ...initial, tags: "" });
      expect(req).toEqual({ id: "rec-1", tags: [] });
    });

    it("does not send an empty due_at (clearing unsupported)", () => {
      const req = buildEditUpsert("rec-1", initial, { ...initial, due_at: "" });
      expect(req).toBeNull();
    });

    it("round-trips edit values from a list item", () => {
      const values = listItemToEditValues({
        id: "rec-1",
        kind: "todo",
        title: "Pay rent",
        status: "open",
        priority: "high",
        timeAt: "2026-07-14",
        tags: ["home", "money"],
        body: "Bank transfer",
        hasDetails: true,
      });
      expect(values).toEqual({
        title: "Pay rent",
        kind: "todo",
        priority: "high",
        due_at: "2026-07-14",
        tags: "home, money",
        body: "Bank transfer",
      });
    });
  });
});
