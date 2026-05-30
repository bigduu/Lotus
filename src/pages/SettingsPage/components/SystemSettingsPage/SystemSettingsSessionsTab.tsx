import { useMemo, useState } from "react";
import { App as AntApp } from "antd";
import { Button, Card, Flex, Switch, Typography } from "antd";
import { useTranslation } from "react-i18next";

import { AgentClient } from "@services/chat/AgentService";
import { useAppStore } from "../../../ChatPage/store";

const { Text } = Typography;

const agentClient = AgentClient.getInstance();

export default function SystemSettingsSessionsTab() {
  const { t } = useTranslation();
  const { modal, message } = AntApp.useApp();

  const chats = useAppStore((s) => s.chats);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const refreshChats = useAppStore((s) => s.refreshChats);
  const loadChats = useAppStore((s) => s.loadChats);
  const loadChatHistory = useAppStore((s) => s.loadChatHistory);

  const [keepPinned, setKeepPinned] = useState(true);
  const [busy, setBusy] = useState(false);

  const current = useMemo(() => {
    if (!currentSessionId) return null;
    return chats.find((c) => c.id === currentSessionId) ?? null;
  }, [chats, currentSessionId]);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Flex vertical gap={16}>
      <Card size="small" title={t("settings.sessionsTab.currentSessionTitle")}>
        {current ? (
          <Flex vertical gap={4}>
            <Text strong ellipsis>
              {current.title}
            </Text>
            <Text type="secondary" ellipsis>
              {t("settings.sessionsTab.id")}: {current.id}
              {"  "}•{"  "}
              {t("settings.sessionsTab.kind")}: {current.kind}
            </Text>
            <Flex gap={8} wrap="wrap" style={{ marginTop: 8 }}>
              <Button
                danger
                loading={busy}
                onClick={() => {
                  modal.confirm({
                    title: t("settings.sessionsTab.clearMessagesTitle"),
                    content: t("settings.sessionsTab.clearMessagesContent"),
                    okText: t("settings.sessionsTab.clear"),
                    okButtonProps: { danger: true },
                    cancelText: t("settings.sessionsTab.cancel"),
                    onOk: async () => {
                      await run(async () => {
                        await agentClient.clearSession(current.id);
                        await loadChatHistory(current.id);
                        await refreshChats();
                        message.success(t("settings.sessionsTab.sessionCleared"));
                      });
                    },
                  });
                }}
              >
                {t("settings.sessionsTab.clearMessages")}
              </Button>
            </Flex>
          </Flex>
        ) : (
          <Text type="secondary">{t("settings.sessionsTab.noActiveSession")}</Text>
        )}
      </Card>

      <Card size="small" title={t("settings.sessionsTab.bulkCleanupTitle")}>
        <Flex align="center" gap={8} style={{ marginBottom: 12 }}>
          <Text>{t("settings.sessionsTab.keepPinned")}</Text>
          <Switch checked={keepPinned} onChange={setKeepPinned} />
        </Flex>

        <Flex gap={8} wrap="wrap">
          <Button
            danger
            loading={busy}
            onClick={() => {
              modal.confirm({
                title: t("settings.sessionsTab.deleteAllTitle"),
                content: keepPinned
                  ? t("settings.sessionsTab.deleteAllKeepPinned")
                  : t("settings.sessionsTab.deleteAllIncludePinned"),
                okText: t("settings.sessionsTab.delete"),
                okButtonProps: { danger: true },
                cancelText: t("settings.sessionsTab.cancel"),
                onOk: async () => {
                  await run(async () => {
                    await agentClient.cleanupSessions("all", keepPinned);
                    await loadChats();
                    message.success(t("settings.sessionsTab.cleanupComplete"));
                  });
                },
              });
            }}
          >
            {t("settings.sessionsTab.deleteAll")}
          </Button>

          <Button
            danger
            loading={busy}
            onClick={() => {
              modal.confirm({
                title: t("settings.sessionsTab.deleteEmptyTitle"),
                content: keepPinned
                  ? t("settings.sessionsTab.deleteEmptyKeepPinned")
                  : t("settings.sessionsTab.deleteEmptyIncludePinned"),
                okText: t("settings.sessionsTab.delete"),
                okButtonProps: { danger: true },
                cancelText: t("settings.sessionsTab.cancel"),
                onOk: async () => {
                  await run(async () => {
                    await agentClient.cleanupSessions("empty", keepPinned);
                    await loadChats();
                    message.success(t("settings.sessionsTab.cleanupComplete"));
                  });
                },
              });
            }}
          >
            {t("settings.sessionsTab.deleteEmpty")}
          </Button>

          <Button
            danger
            loading={busy}
            onClick={() => {
              modal.confirm({
                title: t("settings.sessionsTab.deleteChildrenTitle"),
                content: keepPinned
                  ? t("settings.sessionsTab.deleteChildrenKeepPinned")
                  : t("settings.sessionsTab.deleteChildrenIncludePinned"),
                okText: t("settings.sessionsTab.delete"),
                okButtonProps: { danger: true },
                cancelText: t("settings.sessionsTab.cancel"),
                onOk: async () => {
                  await run(async () => {
                    await agentClient.cleanupSessions("children", keepPinned);
                    await loadChats();
                    message.success(t("settings.sessionsTab.cleanupComplete"));
                  });
                },
              });
            }}
          >
            {t("settings.sessionsTab.deleteChildren")}
          </Button>
        </Flex>
      </Card>

      <Card size="small" title={t("settings.sessionsTab.devResetTitle")}>
        <Text type="secondary">{t("settings.sessionsTab.devResetDescription")}</Text>
        <Flex style={{ marginTop: 12 }}>
          <Button
            danger
            type="primary"
            loading={busy}
            onClick={() => {
              modal.confirm({
                title: t("settings.sessionsTab.devResetConfirmTitle"),
                content: t("settings.sessionsTab.devResetConfirmContent"),
                okText: t("settings.sessionsTab.reset"),
                okButtonProps: { danger: true },
                cancelText: t("settings.sessionsTab.cancel"),
                onOk: async () => {
                  await run(async () => {
                    await agentClient.devResetSessions();
                    await loadChats();
                    message.success(t("settings.sessionsTab.devResetDone"));
                  });
                },
              });
            }}
          >
            {t("settings.sessionsTab.devResetAction")}
          </Button>
        </Flex>
      </Card>
    </Flex>
  );
}
