import type { MisfirePolicy, OverlapPolicy, ScheduleTrigger } from "@services/chat/AgentService";

type TriggerType = ScheduleTrigger["type"];
type WeeklyWeekday = Extract<ScheduleTrigger, { type: "weekly" }>["weekdays"][number];
type MisfirePolicyType = MisfirePolicy["type"];

export interface ScheduleFormValues {
  name: string;
  enabled: boolean;
  trigger_type: TriggerType;
  interval_seconds?: number;
  daily_hour?: number;
  daily_minute?: number;
  weekly_weekdays?: WeeklyWeekday[];
  weekly_hour?: number;
  weekly_minute?: number;
  monthly_days?: string;
  monthly_hour?: number;
  monthly_minute?: number;
  cron_expr?: string;
  timezone?: string;
  start_at?: string;
  end_at?: string;
  misfire_policy?: MisfirePolicyType;
  catch_up_window_max_runs?: number;
  catch_up_window_max_lateness_seconds?: number;
  overlap_policy?: OverlapPolicy;
  system_prompt?: string;
  task_message?: string;
  model?: string;
  workspace_path?: string;
  enhance_prompt?: string;
  auto_execute?: boolean;
}

export function normalizedString(value: unknown): string | undefined {
  const trimmed = String(value ?? "").trim();
  return trimmed || undefined;
}

export function buildIntervalTrigger(everySeconds: number): ScheduleTrigger {
  return {
    type: "interval",
    every_seconds: everySeconds,
  };
}

export function parseMonthlyDays(raw: string | undefined): { days: number[]; invalid: boolean } {
  const value = normalizedString(raw);
  if (!value) {
    return { days: [], invalid: false };
  }
  const chunks = value.split(/[\s,]+/).filter(Boolean);
  const numbers = chunks.map((part) => Number(part));
  const invalid = numbers.some((value) => !Number.isInteger(value) || value < 1 || value > 31);
  const days = Array.from(
    new Set(numbers.filter((value) => Number.isInteger(value) && value >= 1 && value <= 31)),
  );
  return { days, invalid };
}

export function buildTriggerFromValues(values: ScheduleFormValues): {
  trigger?: ScheduleTrigger;
  errorKey?: string;
} {
  switch (values.trigger_type) {
    case "interval": {
      const seconds = Number(values.interval_seconds || 0);
      if (seconds <= 0) {
        return { errorKey: "settings.schedulesTab.validation.intervalRequired" };
      }
      return { trigger: buildIntervalTrigger(seconds) };
    }
    case "daily": {
      const hour = values.daily_hour;
      const minute = values.daily_minute;
      if (hour == null || minute == null) {
        return { errorKey: "settings.schedulesTab.validation.triggerRequired" };
      }
      return {
        trigger: {
          type: "daily",
          hour,
          minute,
          second: 0,
        },
      };
    }
    case "weekly": {
      const weekdays = values.weekly_weekdays || [];
      const hour = values.weekly_hour;
      const minute = values.weekly_minute;
      if (weekdays.length === 0) {
        return { errorKey: "settings.schedulesTab.validation.weekdaysRequired" };
      }
      if (hour == null || minute == null) {
        return { errorKey: "settings.schedulesTab.validation.triggerRequired" };
      }
      return {
        trigger: {
          type: "weekly",
          weekdays,
          hour,
          minute,
          second: 0,
        },
      };
    }
    case "monthly": {
      const { days, invalid } = parseMonthlyDays(values.monthly_days);
      if (invalid) {
        return { errorKey: "settings.schedulesTab.validation.invalidMonthDays" };
      }
      if (days.length === 0) {
        return { errorKey: "settings.schedulesTab.validation.monthDaysRequired" };
      }
      const hour = values.monthly_hour;
      const minute = values.monthly_minute;
      if (hour == null || minute == null) {
        return { errorKey: "settings.schedulesTab.validation.triggerRequired" };
      }
      return {
        trigger: {
          type: "monthly",
          days,
          hour,
          minute,
          second: 0,
        },
      };
    }
    case "cron": {
      const expr = normalizedString(values.cron_expr);
      if (!expr) {
        return { errorKey: "settings.schedulesTab.validation.cronRequired" };
      }
      return {
        trigger: {
          type: "cron",
          expr,
        },
      };
    }
    default:
      return { errorKey: "settings.schedulesTab.validation.triggerRequired" };
  }
}

export function buildMisfirePolicy(values: ScheduleFormValues): MisfirePolicy | undefined {
  switch (values.misfire_policy) {
    case "skip":
      return { type: "skip" };
    case "catch_up_all":
      return { type: "catch_up_all" };
    case "catch_up_window":
      return {
        type: "catch_up_window",
        max_catch_up_runs: Number(values.catch_up_window_max_runs || 1),
        max_lateness_seconds: Number(values.catch_up_window_max_lateness_seconds || 60),
      };
    case "run_once":
    default:
      return { type: "run_once" };
  }
}
