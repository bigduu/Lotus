import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LedgerDrawer } from "../index";
import { useLedgerViewStore } from "@shared/store/ledgerViewStore";

const mockGetAgenda = vi.fn();
const mockListRecords = vi.fn();
const mockUpsertRecord = vi.fn();
const mockPatchRecord = vi.fn();
const mockDeleteRecord = vi.fn();

vi.mock("@services/ledger/LedgerService", () => ({
  LedgerClient: {
    getInstance: () => ({
      getAgenda: (...args: unknown[]) => mockGetAgenda(...args),
      listRecords: (...args: unknown[]) => mockListRecords(...args),
      upsertRecord: (...args: unknown[]) => mockUpsertRecord(...args),
      patchRecord: (...args: unknown[]) => mockPatchRecord(...args),
      deleteRecord: (...args: unknown[]) => mockDeleteRecord(...args),
    }),
  },
}));

const LEDGER_UI_TEST_TIMEOUT_MS = 15000;

function agendaItem(overrides: Record<string, unknown>) {
  return {
    id: "rec-1",
    scope: "global",
    kind: "todo",
    title: "Untitled",
    status: "open",
    priority: "medium",
    ...overrides,
  };
}

describe("LedgerDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLedgerViewStore.setState({ isOpen: true, view: "agenda", badgeCount: 0 });

    mockGetAgenda.mockResolvedValue({
      generated_at: "2026-07-13T08:00:00Z",
      overdue: [
        agendaItem({
          id: "rec-overdue",
          title: "Pay rent",
          priority: "high",
          project_key: "proj-1",
          scope: "project",
          anchor_at: "2026-07-10T08:00:00Z",
          due_at: "2026-07-10T08:00:00Z",
        }),
      ],
      today: [
        agendaItem({
          id: "rec-today",
          kind: "event",
          title: "Team standup",
          anchor_at: "2026-07-13T09:30:00Z",
        }),
      ],
      upcoming: [
        agendaItem({
          id: "rec-upcoming",
          kind: "reminder",
          title: "Dentist appointment",
          anchor_at: "2026-07-16T14:00:00Z",
        }),
      ],
      undated: [agendaItem({ id: "rec-undated", title: "Read a book" })],
    });
    mockListRecords.mockResolvedValue({ records: [], returned: 0, matched: 0 });
    mockUpsertRecord.mockResolvedValue({
      result: "create",
      record: agendaItem({ id: "rec-new" }),
      body: "",
    });
    mockPatchRecord.mockResolvedValue({
      record: agendaItem({ id: "rec-overdue", status: "done" }),
      body: "",
    });
  });

  it(
    "renders all agenda buckets with their items",
    async () => {
      render(<LedgerDrawer />);

      expect(await screen.findByText("Pay rent")).toBeInTheDocument();
      expect(screen.getByText("Team standup")).toBeInTheDocument();
      expect(screen.getByText("Dentist appointment")).toBeInTheDocument();
      expect(screen.getByText("Read a book")).toBeInTheDocument();

      expect(screen.getByText(/Overdue \(1\)/)).toBeInTheDocument();
      expect(screen.getByText(/Today \(1\)/)).toBeInTheDocument();
      expect(screen.getByText(/Upcoming \(1\)/)).toBeInTheDocument();
      expect(screen.getByText(/Undated \(1\)/)).toBeInTheDocument();
    },
    LEDGER_UI_TEST_TIMEOUT_MS,
  );

  it(
    "updates the trigger badge count from overdue + today",
    async () => {
      render(<LedgerDrawer />);

      await screen.findByText("Pay rent");
      await waitFor(() => {
        expect(useLedgerViewStore.getState().badgeCount).toBe(2);
      });
    },
    LEDGER_UI_TEST_TIMEOUT_MS,
  );

  it(
    "marks an item done via PATCH (with project key) and refetches the agenda",
    async () => {
      render(<LedgerDrawer />);

      await screen.findByText("Pay rent");
      const initialAgendaCalls = mockGetAgenda.mock.calls.length;

      const row = screen.getByTestId("ledger-item-rec-overdue");
      fireEvent.click(within(row).getByRole("button", { name: "Mark done" }));

      await waitFor(() => {
        expect(mockPatchRecord).toHaveBeenCalledWith("rec-overdue", { status: "done" }, "proj-1");
      });
      await waitFor(() => {
        expect(mockGetAgenda.mock.calls.length).toBeGreaterThan(initialAgendaCalls);
      });
    },
    LEDGER_UI_TEST_TIMEOUT_MS,
  );

  it(
    "reopens a terminal item",
    async () => {
      mockGetAgenda.mockResolvedValue({
        generated_at: "2026-07-13T08:00:00Z",
        overdue: [],
        today: [],
        upcoming: [],
        undated: [agendaItem({ id: "rec-done", title: "Old chore", status: "done" })],
      });

      render(<LedgerDrawer />);

      await screen.findByText("Old chore");
      const row = screen.getByTestId("ledger-item-rec-done");
      fireEvent.click(within(row).getByRole("button", { name: "Reopen" }));

      await waitFor(() => {
        expect(mockPatchRecord).toHaveBeenCalledWith("rec-done", { status: "open" }, undefined);
      });
    },
    LEDGER_UI_TEST_TIMEOUT_MS,
  );

  it(
    "cancels an item with an optional reason",
    async () => {
      render(<LedgerDrawer />);

      await screen.findByText("Pay rent");
      const row = screen.getByTestId("ledger-item-rec-overdue");
      fireEvent.click(within(row).getByRole("button", { name: "Cancel record" }));

      const reasonInput = await screen.findByPlaceholderText("Why is this record cancelled?");
      fireEvent.change(reasonInput, { target: { value: "No longer needed" } });
      // Row cancel actions share the "Cancel record" label; pick the modal OK button.
      const confirmButton = screen
        .getAllByRole("button", { name: "Cancel record" })
        .find((button) => button.closest(".ant-modal"));
      expect(confirmButton).toBeTruthy();
      fireEvent.click(confirmButton as HTMLElement);

      await waitFor(() => {
        expect(mockPatchRecord).toHaveBeenCalledWith(
          "rec-overdue",
          { status: "cancelled", reason: "No longer needed" },
          "proj-1",
        );
      });
    },
    LEDGER_UI_TEST_TIMEOUT_MS,
  );

  it(
    "quick-adds a todo via POST upsert",
    async () => {
      render(<LedgerDrawer />);

      await screen.findByText("Pay rent");
      fireEvent.change(screen.getByPlaceholderText("Add a todo…"), {
        target: { value: "Buy milk" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Add todo" }));

      await waitFor(() => {
        expect(mockUpsertRecord).toHaveBeenCalledWith({ kind: "todo", title: "Buy milk" });
      });
    },
    LEDGER_UI_TEST_TIMEOUT_MS,
  );

  it(
    "switches to the all-records view and lists records",
    async () => {
      mockListRecords.mockResolvedValue({
        records: [
          {
            id: "rec-list",
            kind: "habit",
            title: "Morning run",
            status: "in_progress",
            priority: "low",
            scope: "global",
            created_at: "2026-07-01T00:00:00Z",
            updated_at: "2026-07-01T00:00:00Z",
          },
        ],
        returned: 1,
        matched: 1,
      });

      render(<LedgerDrawer />);

      await screen.findByText("Pay rent");
      fireEvent.click(screen.getByText("All records"));

      await waitFor(() => {
        expect(mockListRecords).toHaveBeenCalledWith(
          expect.objectContaining({ includeTerminal: false, limit: 50 }),
        );
      });
      expect(await screen.findByText("Morning run")).toBeInTheDocument();
    },
    LEDGER_UI_TEST_TIMEOUT_MS,
  );

  it(
    "edits an item and upserts only the changed fields",
    async () => {
      render(<LedgerDrawer />);

      await screen.findByText("Pay rent");
      const row = screen.getByTestId("ledger-item-rec-overdue");
      fireEvent.click(within(row).getByRole("button", { name: "Edit" }));

      const titleInput = await screen.findByLabelText("Title");
      fireEvent.change(titleInput, { target: { value: "Pay rent (July)" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => {
        expect(mockUpsertRecord).toHaveBeenCalledWith({
          id: "rec-overdue",
          title: "Pay rent (July)",
        });
      });
    },
    LEDGER_UI_TEST_TIMEOUT_MS,
  );
});
