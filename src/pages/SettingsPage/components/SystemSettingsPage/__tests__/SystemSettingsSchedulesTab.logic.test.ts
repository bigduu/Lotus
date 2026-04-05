import { describe, expect, it } from "vitest";

import {
  buildMisfirePolicy,
  buildTriggerFromValues,
  parseMonthlyDays,
  type ScheduleFormValues,
} from "../SystemSettingsSchedulesTab.logic";

describe("SystemSettingsSchedulesTab logic", () => {
  const baseValues: ScheduleFormValues = {
    name: "Schedule",
    enabled: true,
    trigger_type: "interval",
  };

  it("parseMonthlyDays parses and deduplicates valid days", () => {
    expect(parseMonthlyDays("1, 15 15 28")).toEqual({
      days: [1, 15, 28],
      invalid: false,
    });
  });

  it("parseMonthlyDays marks invalid out-of-range values", () => {
    expect(parseMonthlyDays("0, 32, 15")).toEqual({
      days: [15],
      invalid: true,
    });
  });

  it("buildTriggerFromValues builds weekly trigger", () => {
    const result = buildTriggerFromValues({
      ...baseValues,
      trigger_type: "weekly",
      weekly_weekdays: ["mon", "fri"],
      weekly_hour: 8,
      weekly_minute: 30,
    });

    expect(result).toEqual({
      trigger: {
        type: "weekly",
        weekdays: ["mon", "fri"],
        hour: 8,
        minute: 30,
        second: 0,
      },
    });
  });

  it("buildTriggerFromValues builds cron trigger", () => {
    const result = buildTriggerFromValues({
      ...baseValues,
      trigger_type: "cron",
      cron_expr: "0 9 * * 1-5",
    });

    expect(result).toEqual({
      trigger: {
        type: "cron",
        expr: "0 9 * * 1-5",
      },
    });
  });

  it("buildTriggerFromValues rejects weekly trigger without weekdays", () => {
    const result = buildTriggerFromValues({
      ...baseValues,
      trigger_type: "weekly",
      weekly_weekdays: [],
      weekly_hour: 8,
      weekly_minute: 30,
    });

    expect(result).toEqual({
      errorKey: "settings.schedulesTab.validation.weekdaysRequired",
    });
  });

  it("buildTriggerFromValues rejects monthly trigger with invalid month days", () => {
    const result = buildTriggerFromValues({
      ...baseValues,
      trigger_type: "monthly",
      monthly_days: "0, 32",
      monthly_hour: 8,
      monthly_minute: 30,
    });

    expect(result).toEqual({
      errorKey: "settings.schedulesTab.validation.invalidMonthDays",
    });
  });

  it("buildTriggerFromValues rejects blank cron expression", () => {
    const result = buildTriggerFromValues({
      ...baseValues,
      trigger_type: "cron",
      cron_expr: "   ",
    });

    expect(result).toEqual({
      errorKey: "settings.schedulesTab.validation.cronRequired",
    });
  });

  it("buildMisfirePolicy builds catch-up-window policy", () => {
    const result = buildMisfirePolicy({
      ...baseValues,
      misfire_policy: "catch_up_window",
      catch_up_window_max_runs: 3,
      catch_up_window_max_lateness_seconds: 120,
    });

    expect(result).toEqual({
      type: "catch_up_window",
      max_catch_up_runs: 3,
      max_lateness_seconds: 120,
    });
  });

  it("buildMisfirePolicy defaults to run_once", () => {
    expect(buildMisfirePolicy(baseValues)).toEqual({ type: "run_once" });
  });
});
