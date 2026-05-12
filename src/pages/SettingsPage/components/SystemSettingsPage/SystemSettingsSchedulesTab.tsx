import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useTranslation } from "react-i18next";
import i18n from "../../../../shared/i18n";

import {
  AgentClient,
  MisfirePolicy,
  OverlapPolicy,
  ScheduleEntry,
  ScheduleRunRecord,
  ScheduleTrigger,
} from "../../../ChatPage/services/AgentService";
import { useSettingsViewStore } from "../../../../shared/store/settingsViewStore";
import { openSession } from "../../../ChatPage/utils/openSession";

const { Text } = Typography;

const agentClient = AgentClient.getInstance();

function runStatusColor(status: ScheduleRunRecord["status"]): string {
  switch (status) {
    case "success":
      return "success";
    case "failed":
    case "cancelled":
      return "error";
    case "running":
      return "processing";
    case "queued":
      return "gold";
    case "missed":
    case "skipped":
    default:
      return "default";
  }
}

type TriggerType = ScheduleTrigger["type"];
type WeeklyWeekday = Extract<ScheduleTrigger, { type: "weekly" }>["weekdays"][number];
type MisfirePolicyType = MisfirePolicy["type"];

interface ScheduleFormValues {
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

const WEEKDAY_OPTIONS: Array<{ label: string; value: WeeklyWeekday }> = [
  { label: i18n.t("settings.schedulesTab.weekdays.mon"), value: "mon" },
  { label: i18n.t("settings.schedulesTab.weekdays.tue"), value: "tue" },
  { label: i18n.t("settings.schedulesTab.weekdays.wed"), value: "wed" },
  { label: i18n.t("settings.schedulesTab.weekdays.thu"), value: "thu" },
  { label: i18n.t("settings.schedulesTab.weekdays.fri"), value: "fri" },
  { label: i18n.t("settings.schedulesTab.weekdays.sat"), value: "sat" },
  { label: i18n.t("settings.schedulesTab.weekdays.sun"), value: "sun" },
];

function normalizedString(value: unknown): string | undefined {
  const trimmed = String(value ?? "").trim();
  return trimmed || undefined;
}

function intervalSecondsFromTrigger(trigger: ScheduleTrigger | null | undefined): number | null {
  return trigger?.type === "interval" ? trigger.every_seconds : null;
}

function buildIntervalTrigger(everySeconds: number): ScheduleTrigger {
  return {
    type: "interval",
    every_seconds: everySeconds,
  };
}

function triggerLabel(trigger: ScheduleTrigger): string {
  switch (trigger.type) {
    case "interval":
      return i18n.t("settings.schedulesTab.triggerLabels.interval", {
        type: i18n.t("settings.schedulesTab.triggerTypes.interval"),
        seconds: trigger.every_seconds,
      });
    case "daily":
      return i18n.t("settings.schedulesTab.triggerLabels.daily", {
        type: i18n.t("settings.schedulesTab.triggerTypes.daily"),
        time: `${String(trigger.hour).padStart(2, "0")}:${String(trigger.minute).padStart(2, "0")}`,
      });
    case "weekly":
      return i18n.t("settings.schedulesTab.triggerLabels.weekly", {
        type: i18n.t("settings.schedulesTab.triggerTypes.weekly"),
        weekdays: trigger.weekdays.join(", "),
      });
    case "monthly":
      return i18n.t("settings.schedulesTab.triggerLabels.monthly", {
        type: i18n.t("settings.schedulesTab.triggerTypes.monthly"),
        days: trigger.days.join(", "),
      });
    case "cron":
      return i18n.t("settings.schedulesTab.triggerLabels.cron", {
        type: i18n.t("settings.schedulesTab.triggerTypes.cron"),
        expr: trigger.expr,
      });
  }
}

function misfireLabel(policy: MisfirePolicy | undefined): string {
  switch (policy?.type) {
    case "skip":
      return i18n.t("settings.schedulesTab.misfirePolicyOptions.skip");
    case "catch_up_all":
      return i18n.t("settings.schedulesTab.misfirePolicyOptions.catchUpAll");
    case "catch_up_window":
      return i18n.t("settings.schedulesTab.misfirePolicyOptions.catchUpWindow");
    case "run_once":
    default:
      return i18n.t("settings.schedulesTab.misfirePolicyOptions.runOnce");
  }
}

function overlapLabel(policy: OverlapPolicy | undefined): string {
  switch (policy) {
    case "allow":
      return i18n.t("settings.schedulesTab.overlapPolicyOptions.allow");
    case "skip":
      return i18n.t("settings.schedulesTab.overlapPolicyOptions.skip");
    case "queue_one":
    default:
      return i18n.t("settings.schedulesTab.overlapPolicyOptions.queueOne");
  }
}

function formatNextRun(row: ScheduleEntry): string {
  return row.state?.next_fire_at ? String(row.state.next_fire_at) : "-";
}

function formatLastRun(row: ScheduleEntry): string {
  return row.state?.last_success_at
    ? String(row.state.last_success_at)
    : row.state?.last_finished_at
      ? String(row.state.last_finished_at)
      : "-";
}

function statusTone(row: ScheduleEntry): { color: string; label: string; detail?: string } {
  if (row.state?.running_run_count > 0) {
    return {
      color: "processing",
      label: i18n.t("settings.schedulesTab.statusLabels.running"),
      detail: i18n.t("settings.schedulesTab.statusDetails.active", {
        count: row.state.running_run_count,
      }),
    };
  }
  if ((row.state?.queued_run_count || 0) > 0) {
    return {
      color: "gold",
      label: i18n.t("settings.schedulesTab.statusLabels.queued"),
      detail: i18n.t("settings.schedulesTab.statusDetails.pending", {
        count: row.state.queued_run_count,
      }),
    };
  }
  if ((row.state?.consecutive_failures || 0) > 0) {
    return {
      color: "error",
      label: i18n.t("settings.schedulesTab.statusLabels.failing"),
      detail: i18n.t("settings.schedulesTab.statusDetails.consecutiveFailures", {
        count: row.state.consecutive_failures,
      }),
    };
  }
  if (!row.enabled) {
    return {
      color: "default",
      label: i18n.t("settings.schedulesTab.statusLabels.disabled"),
    };
  }
  if (row.state?.last_success_at) {
    return {
      color: "success",
      label: i18n.t("settings.schedulesTab.statusLabels.healthy"),
      detail: i18n.t("settings.schedulesTab.statusDetails.lastRunSucceeded"),
    };
  }
  return {
    color: "default",
    label: i18n.t("settings.schedulesTab.statusLabels.idle"),
  };
}

function parseMonthlyDays(raw: string | undefined): { days: number[]; invalid: boolean } {
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

function buildTriggerFromValues(values: ScheduleFormValues): {
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

function buildMisfirePolicy(values: ScheduleFormValues): MisfirePolicy | undefined {
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

function scheduleToFormValues(schedule: ScheduleEntry): ScheduleFormValues {
  const base: ScheduleFormValues = {
    name: schedule.name,
    enabled: schedule.enabled,
    trigger_type: schedule.trigger.type,
    timezone: schedule.timezone || "",
    start_at: schedule.start_at || "",
    end_at: schedule.end_at || "",
    misfire_policy: schedule.misfire_policy?.type || "run_once",
    overlap_policy: schedule.overlap_policy || "queue_one",
    system_prompt: schedule.run_config?.system_prompt || "",
    task_message: schedule.run_config?.task_message || "",
    model: schedule.run_config?.model || "",
    workspace_path: schedule.run_config?.workspace_path || "",
    enhance_prompt: schedule.run_config?.enhance_prompt || "",
    auto_execute: Boolean(schedule.run_config?.auto_execute),
  };

  if (schedule.misfire_policy?.type === "catch_up_window") {
    base.catch_up_window_max_runs = schedule.misfire_policy.max_catch_up_runs;
    base.catch_up_window_max_lateness_seconds = schedule.misfire_policy.max_lateness_seconds;
  }

  switch (schedule.trigger.type) {
    case "interval":
      base.interval_seconds = schedule.trigger.every_seconds;
      break;
    case "daily":
      base.daily_hour = schedule.trigger.hour;
      base.daily_minute = schedule.trigger.minute;
      break;
    case "weekly":
      base.weekly_weekdays = schedule.trigger.weekdays;
      base.weekly_hour = schedule.trigger.hour;
      base.weekly_minute = schedule.trigger.minute;
      break;
    case "monthly":
      base.monthly_days = schedule.trigger.days.join(", ");
      base.monthly_hour = schedule.trigger.hour;
      base.monthly_minute = schedule.trigger.minute;
      break;
    case "cron":
      base.cron_expr = schedule.trigger.expr;
      break;
  }

  return base;
}

export default function SystemSettingsSchedulesTab() {
  const { t } = useTranslation();
  const [msgApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(false);
  const [schedules, setSchedules] = useState<ScheduleEntry[]>([]);
  const [sessionsModal, setSessionsModal] = useState<{
    open: boolean;
    scheduleId: string | null;
    sessions: Array<{ id: string; title: string; updated_at: string }>;
    loading: boolean;
  }>({ open: false, scheduleId: null, sessions: [], loading: false });
  const [runsModal, setRunsModal] = useState<{
    open: boolean;
    scheduleId: string | null;
    runs: ScheduleRunRecord[];
    loading: boolean;
  }>({ open: false, scheduleId: null, runs: [], loading: false });
  const [editModal, setEditModal] = useState<{
    open: boolean;
    schedule: ScheduleEntry | null;
    saving: boolean;
  }>({ open: false, schedule: null, saving: false });

  const closeSettings = useSettingsViewStore((s) => s.close);

  const [form] = Form.useForm<ScheduleFormValues>();
  const [editForm] = Form.useForm<ScheduleFormValues>();

  const createTriggerType = Form.useWatch("trigger_type", form) as TriggerType | undefined;
  const createMisfireType = Form.useWatch("misfire_policy", form) as MisfirePolicyType | undefined;
  const editTriggerType = Form.useWatch("trigger_type", editForm) as TriggerType | undefined;
  const editMisfireType = Form.useWatch("misfire_policy", editForm) as
    | MisfirePolicyType
    | undefined;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await agentClient.listSchedules();
      setSchedules(resp.schedules || []);
    } catch (e) {
      console.error("[Schedules] Failed to load schedules:", e);
      msgApi.error(t("settings.schedulesTab.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [msgApi, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const triggerTypeOptions = [
    { value: "interval", label: t("settings.schedulesTab.triggerTypes.interval") },
    { value: "daily", label: t("settings.schedulesTab.triggerTypes.daily") },
    { value: "weekly", label: t("settings.schedulesTab.triggerTypes.weekly") },
    { value: "monthly", label: t("settings.schedulesTab.triggerTypes.monthly") },
    { value: "cron", label: t("settings.schedulesTab.triggerTypes.cron") },
  ];

  const misfireOptions = [
    { value: "run_once", label: t("settings.schedulesTab.misfirePolicyOptions.runOnce") },
    { value: "skip", label: t("settings.schedulesTab.misfirePolicyOptions.skip") },
    { value: "catch_up_all", label: t("settings.schedulesTab.misfirePolicyOptions.catchUpAll") },
    {
      value: "catch_up_window",
      label: t("settings.schedulesTab.misfirePolicyOptions.catchUpWindow"),
    },
  ];

  const overlapOptions = [
    { value: "queue_one", label: t("settings.schedulesTab.overlapPolicyOptions.queueOne") },
    { value: "skip", label: t("settings.schedulesTab.overlapPolicyOptions.skip") },
    { value: "allow", label: t("settings.schedulesTab.overlapPolicyOptions.allow") },
  ];

  const renderTriggerFields = (
    triggerType: TriggerType | undefined,
    misfireType: MisfirePolicyType | undefined,
  ) => (
    <>
      <Flex gap={12} wrap="wrap">
        <Form.Item
          label={t("settings.schedulesTab.form.name")}
          name="name"
          rules={[
            {
              required: true,
              message: t("settings.schedulesTab.validation.nameRequired"),
            },
          ]}
          style={{ flex: "1 1 260px" }}
        >
          <Input />
        </Form.Item>

        <Form.Item
          label={t("settings.schedulesTab.form.triggerType")}
          name="trigger_type"
          rules={[
            {
              required: true,
              message: t("settings.schedulesTab.validation.triggerRequired"),
            },
          ]}
          style={{ width: 220 }}
        >
          <Select options={triggerTypeOptions} />
        </Form.Item>

        <Form.Item
          label={t("settings.schedulesTab.form.enabled")}
          name="enabled"
          valuePropName="checked"
          style={{ width: 120 }}
        >
          <Switch />
        </Form.Item>
      </Flex>

      {triggerType === "interval" ? (
        <Form.Item
          label={t("settings.schedulesTab.form.intervalSeconds")}
          name="interval_seconds"
          rules={[
            {
              required: true,
              message: t("settings.schedulesTab.validation.intervalRequired"),
            },
          ]}
          style={{ width: 220 }}
        >
          <InputNumber min={1} style={{ width: "100%" }} />
        </Form.Item>
      ) : null}

      {triggerType === "daily" ? (
        <Flex gap={12} wrap="wrap">
          <Form.Item
            label={t("settings.schedulesTab.form.dailyHour")}
            name="daily_hour"
            style={{ width: 180 }}
          >
            <InputNumber min={0} max={23} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            label={t("settings.schedulesTab.form.dailyMinute")}
            name="daily_minute"
            style={{ width: 180 }}
          >
            <InputNumber min={0} max={59} style={{ width: "100%" }} />
          </Form.Item>
        </Flex>
      ) : null}

      {triggerType === "weekly" ? (
        <>
          <Form.Item
            label={t("settings.schedulesTab.form.weeklyWeekdays")}
            name="weekly_weekdays"
            style={{ minWidth: 320 }}
          >
            <Select mode="multiple" options={WEEKDAY_OPTIONS} />
          </Form.Item>
          <Flex gap={12} wrap="wrap">
            <Form.Item
              label={t("settings.schedulesTab.form.dailyHour")}
              name="weekly_hour"
              style={{ width: 180 }}
            >
              <InputNumber min={0} max={23} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item
              label={t("settings.schedulesTab.form.dailyMinute")}
              name="weekly_minute"
              style={{ width: 180 }}
            >
              <InputNumber min={0} max={59} style={{ width: "100%" }} />
            </Form.Item>
          </Flex>
        </>
      ) : null}

      {triggerType === "monthly" ? (
        <>
          <Form.Item
            label={t("settings.schedulesTab.form.monthlyDays")}
            name="monthly_days"
            style={{ minWidth: 320 }}
          >
            <Input placeholder={t("settings.schedulesTab.form.monthlyDaysPlaceholder")} />
          </Form.Item>
          <Flex gap={12} wrap="wrap">
            <Form.Item
              label={t("settings.schedulesTab.form.dailyHour")}
              name="monthly_hour"
              style={{ width: 180 }}
            >
              <InputNumber min={0} max={23} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item
              label={t("settings.schedulesTab.form.dailyMinute")}
              name="monthly_minute"
              style={{ width: 180 }}
            >
              <InputNumber min={0} max={59} style={{ width: "100%" }} />
            </Form.Item>
          </Flex>
        </>
      ) : null}

      {triggerType === "cron" ? (
        <Form.Item label={t("settings.schedulesTab.form.cronExpr")} name="cron_expr">
          <Input placeholder={t("settings.schedulesTab.form.cronExprPlaceholder")} />
        </Form.Item>
      ) : null}

      <Flex gap={12} wrap="wrap">
        <Form.Item
          label={t("settings.schedulesTab.form.timezone")}
          name="timezone"
          style={{ flex: "1 1 240px" }}
        >
          <Input placeholder={t("settings.schedulesTab.form.timezonePlaceholder")} />
        </Form.Item>
        <Form.Item
          label={t("settings.schedulesTab.form.startAt")}
          name="start_at"
          style={{ flex: "1 1 240px" }}
        >
          <Input placeholder={t("settings.schedulesTab.form.datetimePlaceholder")} />
        </Form.Item>
        <Form.Item
          label={t("settings.schedulesTab.form.endAt")}
          name="end_at"
          style={{ flex: "1 1 240px" }}
        >
          <Input placeholder={t("settings.schedulesTab.form.datetimePlaceholder")} />
        </Form.Item>
      </Flex>

      <Flex gap={12} wrap="wrap">
        <Form.Item
          label={t("settings.schedulesTab.form.misfirePolicy")}
          name="misfire_policy"
          style={{ flex: "1 1 240px" }}
        >
          <Select options={misfireOptions} />
        </Form.Item>
        <Form.Item
          label={t("settings.schedulesTab.form.overlapPolicy")}
          name="overlap_policy"
          style={{ flex: "1 1 240px" }}
        >
          <Select options={overlapOptions} />
        </Form.Item>
      </Flex>

      {misfireType === "catch_up_window" ? (
        <Flex gap={12} wrap="wrap">
          <Form.Item
            label={t("settings.schedulesTab.form.catchUpWindowMaxRuns")}
            name="catch_up_window_max_runs"
            style={{ width: 220 }}
          >
            <InputNumber min={1} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            label={t("settings.schedulesTab.form.catchUpWindowMaxLatenessSeconds")}
            name="catch_up_window_max_lateness_seconds"
            style={{ width: 260 }}
          >
            <InputNumber min={1} style={{ width: "100%" }} />
          </Form.Item>
        </Flex>
      ) : null}

      <Form.Item label={t("settings.schedulesTab.form.taskMessage")} name="task_message">
        <Input.TextArea
          rows={3}
          placeholder={t("settings.schedulesTab.form.taskMessagePlaceholder")}
        />
      </Form.Item>

      <Form.Item label={t("settings.schedulesTab.form.systemPrompt")} name="system_prompt">
        <Input.TextArea rows={2} placeholder={t("settings.schedulesTab.optional")} />
      </Form.Item>

      <Flex gap={12} wrap="wrap">
        <Form.Item
          label={t("settings.schedulesTab.form.model")}
          name="model"
          style={{ flex: "1 1 240px" }}
        >
          <Input placeholder={t("settings.schedulesTab.form.modelPlaceholder")} />
        </Form.Item>
        <Form.Item
          label={t("settings.schedulesTab.form.workspacePath")}
          name="workspace_path"
          style={{ flex: "1 1 320px" }}
        >
          <Input placeholder={t("settings.schedulesTab.optional")} />
        </Form.Item>
        <Form.Item
          label={t("settings.schedulesTab.form.autoExecute")}
          name="auto_execute"
          valuePropName="checked"
          style={{ width: 160 }}
        >
          <Switch />
        </Form.Item>
      </Flex>

      <Form.Item label={t("settings.schedulesTab.form.enhancePrompt")} name="enhance_prompt">
        <Input.TextArea rows={2} placeholder={t("settings.schedulesTab.optional")} />
      </Form.Item>
    </>
  );

  const columns: ColumnsType<ScheduleEntry> = useMemo(
    () => [
      {
        title: t("settings.schedulesTab.columns.name"),
        key: "name",
        render: (_, row) => (
          <Flex vertical gap={6}>
            <Text strong>{row.name}</Text>
            <Flex gap={6} wrap="wrap">
              <Tag>{triggerLabel(row.trigger)}</Tag>
              {row.timezone ? <Tag color="blue">{row.timezone}</Tag> : null}
              <Tag>{misfireLabel(row.misfire_policy)}</Tag>
              <Tag>{overlapLabel(row.overlap_policy)}</Tag>
            </Flex>
          </Flex>
        ),
      },
      {
        title: t("settings.schedulesTab.columns.status"),
        key: "status",
        render: (_, row) => {
          const status = statusTone(row);
          return (
            <Flex vertical gap={4}>
              <Tag color={status.color}>{status.label}</Tag>
              {status.detail ? <Text type="secondary">{status.detail}</Text> : null}
            </Flex>
          );
        },
      },
      {
        title: t("settings.schedulesTab.columns.activity"),
        key: "activity",
        render: (_, row) => (
          <Flex vertical gap={2}>
            <Text type="secondary">
              {t("settings.schedulesTab.activityLabels.queued", {
                count: row.state?.queued_run_count ?? 0,
              })}
            </Text>
            <Text type="secondary">
              {t("settings.schedulesTab.activityLabels.running", {
                count: row.state?.running_run_count ?? 0,
              })}
            </Text>
            <Text type="secondary">
              {t("settings.schedulesTab.activityLabels.ok", {
                count: row.state?.total_success_count ?? 0,
              })}
            </Text>
            <Text type="secondary">
              {t("settings.schedulesTab.activityLabels.fail", {
                count: row.state?.total_failure_count ?? 0,
              })}
            </Text>
          </Flex>
        ),
      },
      {
        title: t("settings.schedulesTab.columns.nextRun"),
        key: "next_run_at",
        render: (_, row) => <Text type="secondary">{formatNextRun(row)}</Text>,
      },
      {
        title: t("settings.schedulesTab.columns.lastRun"),
        key: "last_run_at",
        render: (_, row) => <Text type="secondary">{formatLastRun(row)}</Text>,
      },
      {
        title: t("settings.schedulesTab.columns.autoExecute"),
        key: "auto_execute",
        render: (_, row) => (
          <Text type={row.run_config?.auto_execute ? undefined : "secondary"}>
            {row.run_config?.auto_execute
              ? t("settings.schedulesTab.yes")
              : t("settings.schedulesTab.no")}
          </Text>
        ),
      },
      {
        title: t("settings.schedulesTab.columns.model"),
        key: "model",
        render: (_, row) => (
          <Text type="secondary">{row.run_config?.model ? String(row.run_config.model) : "-"}</Text>
        ),
      },
      {
        title: t("settings.schedulesTab.columns.enabled"),
        key: "enabled",
        render: (_, row) => (
          <Switch
            checked={row.enabled}
            onChange={async (checked) => {
              try {
                await agentClient.patchSchedule(row.id, { enabled: checked });
                await refresh();
              } catch (e) {
                console.error("[Schedules] Failed to toggle:", e);
                msgApi.error(t("settings.schedulesTab.updateFailed"));
              }
            }}
          />
        ),
      },
      {
        title: t("settings.schedulesTab.columns.actions"),
        key: "actions",
        render: (_, row) => {
          const quickIntervalEditor = (
            <InputNumber
              min={1}
              value={intervalSecondsFromTrigger(row.trigger) ?? undefined}
              disabled={row.trigger.type !== "interval"}
              onChange={async (value) => {
                const next = typeof value === "number" ? value : null;
                if (!next || next <= 0) return;
                try {
                  await agentClient.patchSchedule(row.id, {
                    trigger: buildIntervalTrigger(next),
                  });
                  await refresh();
                } catch (e) {
                  console.error("[Schedules] Failed to patch interval:", e);
                  msgApi.error(t("settings.schedulesTab.updateFailed"));
                }
              }}
            />
          );

          return (
            <Flex vertical gap={8}>
              <Flex gap={8} wrap="wrap">
                <Button
                  size="small"
                  onClick={() => {
                    setEditModal({ open: true, schedule: row, saving: false });
                    editForm.setFieldsValue(scheduleToFormValues(row));
                  }}
                >
                  {t("settings.schedulesTab.actions.edit")}
                </Button>
                <Button
                  size="small"
                  onClick={async () => {
                    try {
                      await agentClient.runScheduleNow(row.id);
                      msgApi.success(t("settings.schedulesTab.enqueuedRun"));
                      await refresh();
                    } catch (e) {
                      console.error("[Schedules] Failed to run now:", e);
                      msgApi.error(t("settings.schedulesTab.runNowFailed"));
                    }
                  }}
                >
                  {t("settings.schedulesTab.actions.runNow")}
                </Button>
                <Button
                  size="small"
                  onClick={async () => {
                    setSessionsModal((s) => ({
                      ...s,
                      open: true,
                      scheduleId: row.id,
                      loading: true,
                      sessions: [],
                    }));
                    try {
                      const resp = await agentClient.listScheduleSessions(row.id);
                      setSessionsModal((s) => ({
                        ...s,
                        open: true,
                        scheduleId: row.id,
                        loading: false,
                        sessions: (resp.sessions || []).map((x) => ({
                          id: x.id,
                          title: x.title,
                          updated_at: x.updated_at,
                        })),
                      }));
                    } catch (e) {
                      console.error("[Schedules] Failed to list sessions:", e);
                      msgApi.error(t("settings.schedulesTab.loadSessionsFailed"));
                      setSessionsModal((s) => ({ ...s, loading: false }));
                    }
                  }}
                >
                  {t("settings.schedulesTab.actions.sessions")}
                </Button>
                <Button
                  size="small"
                  onClick={async () => {
                    setRunsModal((s) => ({
                      ...s,
                      open: true,
                      scheduleId: row.id,
                      loading: true,
                      runs: [],
                    }));
                    try {
                      const resp = await agentClient.listScheduleRuns(row.id);
                      setRunsModal((s) => ({
                        ...s,
                        open: true,
                        scheduleId: row.id,
                        loading: false,
                        runs: resp.runs || [],
                      }));
                    } catch (e) {
                      console.error("[Schedules] Failed to list runs:", e);
                      msgApi.error(t("settings.schedulesTab.loadRunsFailed"));
                      setRunsModal((s) => ({ ...s, loading: false }));
                    }
                  }}
                >
                  {t("settings.schedulesTab.actions.runs")}
                </Button>
                <Button
                  danger
                  size="small"
                  onClick={async () => {
                    try {
                      await agentClient.deleteSchedule(row.id);
                      msgApi.success(t("settings.schedulesTab.deleted"));
                      await refresh();
                    } catch (e) {
                      console.error("[Schedules] Failed to delete:", e);
                      msgApi.error(t("settings.schedulesTab.deleteFailed"));
                    }
                  }}
                >
                  {t("settings.schedulesTab.actions.delete")}
                </Button>
              </Flex>
              <Flex gap={8} align="center" wrap="wrap">
                <Text type="secondary">{t("settings.schedulesTab.columns.intervalSeconds")}</Text>
                {row.trigger.type === "interval" ? (
                  quickIntervalEditor
                ) : (
                  <Tooltip title={t("settings.schedulesTab.nonIntervalReadOnly")}>
                    <span>{quickIntervalEditor}</span>
                  </Tooltip>
                )}
              </Flex>
            </Flex>
          );
        },
      },
    ],
    [editForm, msgApi, refresh, t],
  );

  return (
    <Flex vertical gap={16}>
      {contextHolder}

      <Card title={t("settings.schedulesTab.createTitle")} className="lotus-settings-card">
        <Form<ScheduleFormValues>
          form={form}
          layout="vertical"
          initialValues={{
            name: t("settings.schedulesTab.defaultName"),
            trigger_type: "interval",
            interval_seconds: 3600,
            daily_hour: 9,
            daily_minute: 0,
            weekly_weekdays: ["mon"],
            weekly_hour: 9,
            weekly_minute: 0,
            monthly_days: "1",
            monthly_hour: 9,
            monthly_minute: 0,
            cron_expr: "",
            timezone: "",
            start_at: "",
            end_at: "",
            enabled: false,
            task_message: "",
            model: "",
            auto_execute: true,
            misfire_policy: "run_once",
            overlap_policy: "queue_one",
            catch_up_window_max_runs: 1,
            catch_up_window_max_lateness_seconds: 60,
          }}
          onFinish={async (values) => {
            try {
              const autoExecute = Boolean(values.auto_execute);
              const taskMessage = normalizedString(values.task_message);
              const model = normalizedString(values.model);
              if (autoExecute && !taskMessage) {
                msgApi.error(t("settings.schedulesTab.taskMessageRequired"));
                return;
              }
              const { trigger, errorKey } = buildTriggerFromValues(values);
              if (!trigger) {
                msgApi.error(t(errorKey || "settings.schedulesTab.validation.triggerRequired"));
                return;
              }
              await agentClient.createSchedule({
                name: String(values.name || "").trim(),
                trigger,
                timezone: normalizedString(values.timezone),
                start_at: normalizedString(values.start_at),
                end_at: normalizedString(values.end_at),
                misfire_policy: buildMisfirePolicy(values),
                overlap_policy: values.overlap_policy,
                enabled: Boolean(values.enabled),
                run_config: {
                  system_prompt: normalizedString(values.system_prompt),
                  task_message: taskMessage,
                  model,
                  workspace_path: normalizedString(values.workspace_path),
                  enhance_prompt: normalizedString(values.enhance_prompt),
                  auto_execute: autoExecute,
                },
              });
              msgApi.success(t("settings.schedulesTab.created"));
              form.resetFields();
              await refresh();
            } catch (e) {
              console.error("[Schedules] Failed to create schedule:", e);
              msgApi.error(t("settings.schedulesTab.createFailed"));
            }
          }}
        >
          {renderTriggerFields(createTriggerType, createMisfireType)}

          <Button type="primary" htmlType="submit">
            {t("settings.schedulesTab.actions.create")}
          </Button>
        </Form>
      </Card>

      <Card
        title={t("settings.schedulesTab.listTitle")}
        className="lotus-settings-card"
        extra={
          <Button onClick={() => void refresh()} loading={loading}>
            {t("settings.schedulesTab.actions.refresh")}
          </Button>
        }
      >
        <Table
          rowKey="id"
          columns={columns}
          dataSource={schedules}
          loading={loading}
          pagination={{ pageSize: 10 }}
          scroll={{ x: 1500 }}
        />
      </Card>

      <Modal
        title={t("settings.schedulesTab.scheduleSessionsTitle")}
        open={sessionsModal.open}
        onCancel={() => setSessionsModal((s) => ({ ...s, open: false, scheduleId: null }))}
        footer={null}
      >
        {sessionsModal.loading ? (
          <Text type="secondary">{t("settings.schedulesTab.loading")}</Text>
        ) : (
          <Flex vertical gap={8}>
            {sessionsModal.sessions.length === 0 ? (
              <Text type="secondary">{t("settings.schedulesTab.noSessionsYet")}</Text>
            ) : (
              sessionsModal.sessions.map((s) => (
                <Flex key={s.id} justify="space-between" align="center">
                  <Flex vertical style={{ minWidth: 0 }}>
                    <Text strong ellipsis>
                      {s.title}
                    </Text>
                    <Text type="secondary" ellipsis>
                      {s.id} • {s.updated_at}
                    </Text>
                  </Flex>
                  <Button
                    size="small"
                    onClick={() => {
                      void openSession(s.id, {
                        forceRefreshIndex: true,
                        forceLoadHistory: true,
                        subscribeIfRunning: true,
                        forceSubscribe: true,
                      });
                      closeSettings();
                    }}
                  >
                    {t("settings.schedulesTab.actions.open")}
                  </Button>
                </Flex>
              ))
            )}
          </Flex>
        )}
      </Modal>

      <Modal
        title={t("settings.schedulesTab.scheduleRunsTitle")}
        open={runsModal.open}
        onCancel={() => setRunsModal((s) => ({ ...s, open: false, scheduleId: null }))}
        footer={null}
        width={960}
      >
        {runsModal.loading ? (
          <Text type="secondary">{t("settings.schedulesTab.loading")}</Text>
        ) : runsModal.runs.length === 0 ? (
          <Text type="secondary">{t("settings.schedulesTab.noRunsYet")}</Text>
        ) : (
          <Table
            rowKey="run_id"
            pagination={{ pageSize: 8 }}
            dataSource={runsModal.runs}
            columns={[
              {
                title: t("settings.schedulesTab.runHistory.columns.status"),
                key: "status",
                render: (_, run) => <Tag color={runStatusColor(run.status)}>{run.status}</Tag>,
              },
              {
                title: t("settings.schedulesTab.runHistory.columns.scheduledFor"),
                dataIndex: "scheduled_for",
                key: "scheduled_for",
              },
              {
                title: t("settings.schedulesTab.runHistory.columns.startedAt"),
                key: "started_at",
                render: (_, run) => run.started_at || "-",
              },
              {
                title: t("settings.schedulesTab.runHistory.columns.completedAt"),
                key: "completed_at",
                render: (_, run) => run.completed_at || "-",
              },
              {
                title: t("settings.schedulesTab.runHistory.columns.session"),
                key: "session_id",
                render: (_, run) => run.session_id || "-",
              },
              {
                title: t("settings.schedulesTab.runHistory.columns.duration"),
                key: "execution_duration_ms",
                render: (_, run) =>
                  run.execution_duration_ms != null ? `${run.execution_duration_ms}ms` : "-",
              },
              {
                title: t("settings.schedulesTab.runHistory.columns.outcome"),
                key: "outcome_reason",
                render: (_, run) => run.outcome_reason || (run.was_catch_up ? "catch-up" : "-"),
              },
            ]}
          />
        )}
      </Modal>

      <Modal
        title={t("settings.schedulesTab.editTitle")}
        open={editModal.open}
        onCancel={() => setEditModal({ open: false, schedule: null, saving: false })}
        okText={t("settings.schedulesTab.actions.save")}
        confirmLoading={editModal.saving}
        onOk={() => editForm.submit()}
        forceRender
      >
        <Form<ScheduleFormValues>
          form={editForm}
          layout="vertical"
          onFinish={async (values) => {
            const schedule = editModal.schedule;
            if (!schedule) return;

            const autoExecute = Boolean(values.auto_execute);
            const taskMessage = normalizedString(values.task_message);
            const model = normalizedString(values.model);
            if (autoExecute && !taskMessage) {
              msgApi.error(t("settings.schedulesTab.taskMessageRequired"));
              return;
            }

            const { trigger, errorKey } = buildTriggerFromValues(values);
            if (!trigger) {
              msgApi.error(t(errorKey || "settings.schedulesTab.validation.triggerRequired"));
              return;
            }

            setEditModal((s) => ({ ...s, saving: true }));
            try {
              await agentClient.patchSchedule(schedule.id, {
                name: String(values.name || "").trim() || undefined,
                enabled: Boolean(values.enabled),
                trigger,
                timezone: normalizedString(values.timezone),
                start_at: normalizedString(values.start_at),
                end_at: normalizedString(values.end_at),
                misfire_policy: buildMisfirePolicy(values),
                overlap_policy: values.overlap_policy,
                run_config: {
                  system_prompt: normalizedString(values.system_prompt),
                  task_message: taskMessage,
                  model,
                  workspace_path: normalizedString(values.workspace_path),
                  enhance_prompt: normalizedString(values.enhance_prompt),
                  auto_execute: autoExecute,
                },
              });
              msgApi.success(t("settings.schedulesTab.updated"));
              setEditModal({ open: false, schedule: null, saving: false });
              await refresh();
            } catch (e) {
              console.error("[Schedules] Failed to patch schedule:", e);
              msgApi.error(t("settings.schedulesTab.updateFailed"));
              setEditModal((s) => ({ ...s, saving: false }));
            }
          }}
        >
          {renderTriggerFields(editTriggerType, editMisfireType)}
        </Form>
      </Modal>
    </Flex>
  );
}
