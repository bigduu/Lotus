import { Flex, Form, Input, InputNumber, Select, Switch } from "antd";
import { useTranslation } from "react-i18next";
import i18n from "@shared/i18n";

import type { MisfirePolicy, ScheduleTrigger } from "@services/chat/AgentService";

export type ScheduleTriggerType = ScheduleTrigger["type"];
export type ScheduleWeeklyWeekday = Extract<
  ScheduleTrigger,
  { type: "weekly" }
>["weekdays"][number];
export type ScheduleMisfirePolicyType = MisfirePolicy["type"];

const WEEKDAY_OPTIONS: Array<{ label: string; value: ScheduleWeeklyWeekday }> = [
  { label: i18n.t("settings.schedulesTab.weekdays.mon"), value: "mon" },
  { label: i18n.t("settings.schedulesTab.weekdays.tue"), value: "tue" },
  { label: i18n.t("settings.schedulesTab.weekdays.wed"), value: "wed" },
  { label: i18n.t("settings.schedulesTab.weekdays.thu"), value: "thu" },
  { label: i18n.t("settings.schedulesTab.weekdays.fri"), value: "fri" },
  { label: i18n.t("settings.schedulesTab.weekdays.sat"), value: "sat" },
  { label: i18n.t("settings.schedulesTab.weekdays.sun"), value: "sun" },
];

/** Hour (0-23) + minute (0-59) form fields shared by the daily/weekly/monthly triggers. */
export function HourMinuteFields({
  hourName,
  minuteName,
}: {
  hourName: string;
  minuteName: string;
}) {
  const { t } = useTranslation();
  return (
    <Flex gap={12} wrap="wrap">
      <Form.Item
        label={t("settings.schedulesTab.form.dailyHour")}
        name={hourName}
        style={{ width: 180 }}
      >
        <InputNumber min={0} max={23} style={{ width: "100%" }} />
      </Form.Item>
      <Form.Item
        label={t("settings.schedulesTab.form.dailyMinute")}
        name={minuteName}
        style={{ width: 180 }}
      >
        <InputNumber min={0} max={59} style={{ width: "100%" }} />
      </Form.Item>
    </Flex>
  );
}

export interface ScheduleTriggerFieldsProps {
  triggerType: ScheduleTriggerType | undefined;
  misfireType: ScheduleMisfirePolicyType | undefined;
}

/**
 * The full schedule create/edit form body: name + trigger type + enabled,
 * trigger-specific fields (interval/daily/weekly/monthly/cron), timezone /
 * start / end, misfire + overlap policy, task message / system prompt /
 * model / workspace / auto-execute / enhance prompt.
 *
 * Extracted out of `SystemSettingsSchedulesTab` so it can be shared verbatim
 * between that tab's create + edit forms and `ScheduleThisModal`'s
 * session-prefilled create form (Lotus #100), keeping all three in sync
 * instead of drifting as separate copies. Must be rendered inside an antd
 * `<Form>` — every field below is a bare `Form.Item` addressed by name,
 * resolved against the nearest Form context.
 */
export function ScheduleTriggerFields({ triggerType, misfireType }: ScheduleTriggerFieldsProps) {
  const { t } = useTranslation();

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

  return (
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
        <HourMinuteFields hourName="daily_hour" minuteName="daily_minute" />
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
          <HourMinuteFields hourName="weekly_hour" minuteName="weekly_minute" />
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
          <HourMinuteFields hourName="monthly_hour" minuteName="monthly_minute" />
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
}
