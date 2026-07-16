import { App as AntdApp } from "antd";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import SystemSettingsSchedulesTab from "../SystemSettingsSchedulesTab";

const mockCreateSchedule = vi.fn();
const mockListSchedules = vi.fn();
const mockPatchSchedule = vi.fn();
const mockRunScheduleNow = vi.fn();
const mockDeleteSchedule = vi.fn();
const mockListScheduleSessions = vi.fn();
const mockListScheduleRuns = vi.fn();

const SCHEDULES_UI_TEST_TIMEOUT_MS = 20000;

vi.mock("../../../../../services/chat/AgentService", async () => {
  const actual = await vi.importActual("../../../../../services/chat/AgentService");
  return {
    ...actual,
    AgentClient: {
      getInstance: () => ({
        listSchedules: (...args: unknown[]) => mockListSchedules(...args),
        patchSchedule: (...args: unknown[]) => mockPatchSchedule(...args),
        runScheduleNow: (...args: unknown[]) => mockRunScheduleNow(...args),
        deleteSchedule: (...args: unknown[]) => mockDeleteSchedule(...args),
        listScheduleSessions: (...args: unknown[]) => mockListScheduleSessions(...args),
        listScheduleRuns: (...args: unknown[]) => mockListScheduleRuns(...args),
        createSchedule: (...args: unknown[]) => mockCreateSchedule(...args),
      }),
    },
  };
});

vi.mock("../../../../shared/store/settingsViewStore", () => ({
  useSettingsViewStore: (selector: (state: { close: () => void }) => unknown) =>
    selector({ close: vi.fn() }),
}));

vi.mock("@shared/utils/openSession", () => ({
  openSession: vi.fn(),
}));

describe("SystemSettingsSchedulesTab", () => {
  const originalGetComputedStyle = window.getComputedStyle;

  beforeAll(() => {
    vi.spyOn(window, "getComputedStyle").mockImplementation((elt) => originalGetComputedStyle(elt));
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSchedule.mockResolvedValue({});
    mockPatchSchedule.mockResolvedValue({});
    mockRunScheduleNow.mockResolvedValue({});
    mockDeleteSchedule.mockResolvedValue({});
    mockListScheduleSessions.mockResolvedValue({ schedule_id: "sched-1", sessions: [] });
    mockListScheduleRuns.mockResolvedValue({ schedule_id: "sched-1", runs: [] });
    mockListSchedules.mockResolvedValue({
      schedules: [
        {
          id: "sched-1",
          name: "Daily report",
          enabled: true,
          trigger: { type: "interval", every_seconds: 300 },
          timezone: "UTC",
          start_at: null,
          end_at: null,
          misfire_policy: { type: "run_once" },
          overlap_policy: "queue_one",
          created_at: "2026-04-05T00:00:00Z",
          updated_at: "2026-04-05T00:00:00Z",
          state: {
            next_fire_at: "2026-04-05T00:05:00Z",
            last_scheduled_at: "2026-04-05T00:00:00Z",
            last_started_at: null,
            last_finished_at: "2026-04-05T00:00:10Z",
            last_success_at: "2026-04-05T00:00:10Z",
            last_failure_at: null,
            queued_run_count: 1,
            running_run_count: 0,
            consecutive_failures: 0,
            total_run_count: 4,
            total_success_count: 4,
            total_failure_count: 0,
            total_missed_count: 0,
          },
          run_config: {
            auto_execute: true,
            model: "gpt-4o-mini",
          },
        },
        {
          id: "sched-2",
          name: "Weekly digest",
          enabled: false,
          trigger: { type: "weekly", weekdays: ["mon", "fri"], hour: 9, minute: 30, second: 0 },
          timezone: "Asia/Shanghai",
          start_at: null,
          end_at: null,
          misfire_policy: { type: "skip" },
          overlap_policy: "skip",
          created_at: "2026-04-05T00:00:00Z",
          updated_at: "2026-04-05T00:00:00Z",
          state: {
            next_fire_at: null,
            last_scheduled_at: null,
            last_started_at: null,
            last_finished_at: null,
            last_success_at: null,
            last_failure_at: null,
            queued_run_count: 0,
            running_run_count: 0,
            consecutive_failures: 2,
            total_run_count: 3,
            total_success_count: 1,
            total_failure_count: 2,
            total_missed_count: 1,
          },
          run_config: {
            auto_execute: false,
            model: undefined,
          },
        },
      ],
    });
  });

  it(
    "renders schedules with trigger and activity information",
    async () => {
      render(
        <AntdApp>
          <SystemSettingsSchedulesTab />
        </AntdApp>,
      );

      expect(await screen.findByText("Daily report")).toBeInTheDocument();
      expect(screen.getByText("Interval · 300s")).toBeInTheDocument();
      expect(screen.getByText("Queued: 1")).toBeInTheDocument();
      expect(screen.getByText("OK: 4")).toBeInTheDocument();
      expect(screen.getByText("Weekly digest")).toBeInTheDocument();
      expect(screen.getByText("Weekly · mon, fri")).toBeInTheDocument();
      expect(screen.getByText("Failing")).toBeInTheDocument();
    },
    SCHEDULES_UI_TEST_TIMEOUT_MS,
  );

  it(
    "disables quick interval editing for non-interval schedules",
    async () => {
      render(
        <AntdApp>
          <SystemSettingsSchedulesTab />
        </AntdApp>,
      );

      const weeklyDigest = await screen.findByText("Weekly digest", {}, { timeout: 15000 });
      const row = weeklyDigest.closest("tr");
      expect(row).not.toBeNull();

      const intervalInput = within(row as HTMLTableRowElement).getByRole(
        "spinbutton",
      ) as HTMLInputElement;
      expect(intervalInput).toBeDisabled();
    },
    SCHEDULES_UI_TEST_TIMEOUT_MS,
  );

  it(
    "calls runScheduleNow when run now action is clicked",
    async () => {
      render(
        <AntdApp>
          <SystemSettingsSchedulesTab />
        </AntdApp>,
      );

      await screen.findByText("Daily report");
      fireEvent.click(screen.getAllByText("Run Now")[0]);

      await waitFor(() => {
        expect(mockRunScheduleNow).toHaveBeenCalledWith("sched-1");
      });
    },
    SCHEDULES_UI_TEST_TIMEOUT_MS,
  );

  it(
    "opens sessions modal and loads sessions",
    async () => {
      mockListScheduleSessions.mockResolvedValue({
        schedule_id: "sched-1",
        sessions: [{ id: "sess-1", title: "Run Session", updated_at: "2026-04-05T00:00:00Z" }],
      });

      render(
        <AntdApp>
          <SystemSettingsSchedulesTab />
        </AntdApp>,
      );

      await screen.findByText("Daily report");
      fireEvent.click(screen.getAllByText("Sessions")[0]);

      await waitFor(() => {
        expect(mockListScheduleSessions).toHaveBeenCalledWith("sched-1");
      });
      expect(screen.getByText("Schedule Sessions")).toBeInTheDocument();
    },
    SCHEDULES_UI_TEST_TIMEOUT_MS,
  );

  // NOTE:
  // The payload-building paths for weekly / cron / catch-up-window schedule creation
  // are covered in `SystemSettingsSchedulesTab.logic.test.ts`.
  // We intentionally keep this UI suite focused on stable smoke interactions and avoid
  // brittle Antd Select/Form orchestration assertions here.

  // NOTE: detailed Runs modal interaction is deferred to a later batch.
  // The /runs API path is already covered by AgentService tests, and the page path is kept type-safe via TypeScript.
});
