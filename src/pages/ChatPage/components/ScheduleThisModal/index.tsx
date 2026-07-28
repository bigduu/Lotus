import { useMemo } from "react";
import { Button, Form, Modal, Typography, message } from "antd";
import { useTranslation } from "react-i18next";

import { AgentClient } from "@services/chat/AgentService";
import { selectSessionById, useAppStore } from "@shared/store/appStore";
import { useActiveModel } from "@pages/ChatPage/hooks/useActiveModel";
import type { ChatItem } from "@shared/types/chat";
import {
  ScheduleTriggerFields,
  type ScheduleMisfirePolicyType,
  type ScheduleTriggerType,
} from "@pages/SettingsPage/components/SystemSettingsPage/ScheduleFormFields";
import {
  type ScheduleFormValues,
  normalizedString,
  buildTriggerFromValues,
  buildMisfirePolicy,
} from "@pages/SettingsPage/components/SystemSettingsPage/SystemSettingsSchedulesTab.logic";

const { Text } = Typography;

// Keeps a pathologically large first message out of both the form field and
// the eventual schedule payload; long enough that real prompts are never cut.
const TASK_MESSAGE_MAX_LENGTH = 4000;

/**
 * Best-effort "prompt seed" for a session being turned into a schedule
 * (Lotus #100): the session's first user message, falling back to its title
 * when no message content is loaded locally (e.g. the sidebar list item was
 * never opened, so its message history hasn't been fetched into the store).
 */
function derivePromptSeed(chat: ChatItem): string {
  for (const m of chat.messages) {
    if (m.role === "user" && "content" in m && typeof m.content === "string") {
      const text = m.content.trim();
      if (text) {
        return text.length > TASK_MESSAGE_MAX_LENGTH
          ? `${text.slice(0, TASK_MESSAGE_MAX_LENGTH)}…`
          : text;
      }
    }
  }
  return chat.title?.trim() || "";
}

export interface ScheduleThisModalProps {
  open: boolean;
  sessionId: string | null;
  onClose: () => void;
}

/**
 * "Schedule this…" (Lotus #100): opens the same schedule-create form used by
 * Settings → Schedules (`ScheduleTriggerFields`, shared verbatim), prefilled
 * from a chat session — its workspace, active model, and a prompt seed drawn
 * from the session's first user message (or title as a fallback) — so the
 * user only has to pick a trigger and save.
 */
export function ScheduleThisModal({ open, sessionId, onClose }: ScheduleThisModalProps) {
  const { t } = useTranslation();
  const [msgApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm<ScheduleFormValues>();

  const chat = useAppStore(selectSessionById(sessionId));
  const activeModel = useActiveModel(sessionId);

  const triggerType = Form.useWatch("trigger_type", form) as ScheduleTriggerType | undefined;
  const misfireType = Form.useWatch("misfire_policy", form) as
    | ScheduleMisfirePolicyType
    | undefined;

  const initialValues: ScheduleFormValues = useMemo(() => {
    const promptSeed = chat ? derivePromptSeed(chat) : "";
    const workspacePath = chat?.config.workspacePath?.trim() || "";
    const systemPrompt = chat?.config.baseSystemPrompt?.trim() || "";
    const name = chat?.title?.trim()
      ? t("settings.schedulesTab.scheduleThis.defaultNameTemplate", { title: chat.title.trim() })
      : t("settings.schedulesTab.defaultName");

    return {
      name,
      // Prefilled from a real, just-run session — default to "on" so saving
      // is a single action, unlike the blank create form (which defaults to
      // disabled until the user has reviewed a from-scratch trigger).
      enabled: true,
      trigger_type: "daily",
      daily_hour: 9,
      daily_minute: 0,
      weekly_weekdays: ["mon"],
      weekly_hour: 9,
      weekly_minute: 0,
      monthly_days: "1",
      monthly_hour: 9,
      monthly_minute: 0,
      interval_seconds: 3600,
      cron_expr: "",
      timezone: "",
      start_at: "",
      end_at: "",
      task_message: promptSeed,
      system_prompt: systemPrompt,
      model: activeModel || "",
      workspace_path: workspacePath,
      auto_execute: true,
      misfire_policy: "run_once",
      overlap_policy: "queue_one",
      catch_up_window_max_runs: 1,
      catch_up_window_max_lateness_seconds: 60,
    };
  }, [activeModel, chat, t]);

  const handleFinish = async (values: ScheduleFormValues) => {
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

    try {
      await AgentClient.getInstance().createSchedule({
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
          // A scheduled task created from a Project session is another root
          // session in that same long-lived Project. Workspace alone is
          // mutable execution context and must not be used to infer identity.
          project_id: chat?.config.projectId?.trim() || null,
          workspace_path: normalizedString(values.workspace_path),
          enhance_prompt: normalizedString(values.enhance_prompt),
          auto_execute: autoExecute,
        },
      });
      msgApi.success(t("settings.schedulesTab.created"));
      onClose();
    } catch (e) {
      console.error("[ScheduleThisModal] Failed to create schedule:", e);
      msgApi.error(t("settings.schedulesTab.createFailed"));
    }
  };

  return (
    <>
      {contextHolder}
      <Modal
        title={t("settings.schedulesTab.scheduleThis.title")}
        open={open}
        onCancel={onClose}
        okText={t("settings.schedulesTab.actions.create")}
        onOk={() => form.submit()}
        destroyOnClose
        width={720}
      >
        <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
          {t("settings.schedulesTab.scheduleThis.description")}
        </Text>
        <Form<ScheduleFormValues>
          form={form}
          layout="vertical"
          initialValues={initialValues}
          onFinish={handleFinish}
        >
          <ScheduleTriggerFields triggerType={triggerType} misfireType={misfireType} />
          {/* Submit is driven by the Modal's own OK button (`form.submit()`
              above); this hidden trigger lets pressing Enter inside a text
              field submit the form the same way the Settings tab's inline
              form does. */}
          <Button htmlType="submit" style={{ display: "none" }} aria-hidden />
        </Form>
      </Modal>
    </>
  );
}

export default ScheduleThisModal;
