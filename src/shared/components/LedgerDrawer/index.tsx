import React, { useCallback, useEffect, useState } from "react";
import {
  Button,
  Drawer,
  Empty,
  Flex,
  Form,
  Input,
  Modal,
  Segmented,
  Select,
  Spin,
  Switch,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  BellOutlined,
  CalendarOutlined,
  CheckOutlined,
  CheckSquareOutlined,
  EditOutlined,
  PlusOutlined,
  RedoOutlined,
  ReloadOutlined,
  StopOutlined,
  SyncOutlined,
  TagOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";

import {
  LedgerClient,
  type AgendaSnapshot,
  type LedgerRecord,
  type PatchRecordRequest,
  type RecordKind,
  type RecordStatus,
} from "@services/ledger/LedgerService";
import { useLedgerViewStore, type LedgerViewKey } from "@shared/store/ledgerViewStore";
import { useIsMobile } from "@shared/hooks/useMediaQuery";
import {
  agendaBadgeCount,
  agendaItemToListItem,
  buildEditUpsert,
  buildQuickAddRequest,
  formatAgendaTime,
  isTerminalStatus,
  kindTagColor,
  listItemToEditValues,
  priorityTagColor,
  recordToListItem,
  statusTagColor,
  type LedgerEditFormValues,
  type LedgerListItem,
} from "./logic";

const { Text } = Typography;

const ledgerClient = LedgerClient.getInstance();

const KNOWN_KINDS: RecordKind[] = ["todo", "event", "reminder", "habit"];
const ALL_STATUSES: RecordStatus[] = [
  "open",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
  "expired",
];
const PRIORITIES = ["low", "medium", "high", "critical"] as const;

function kindIcon(kind: RecordKind): React.ReactNode {
  switch (kind) {
    case "todo":
      return <CheckSquareOutlined />;
    case "event":
      return <CalendarOutlined />;
    case "reminder":
      return <BellOutlined />;
    case "habit":
      return <SyncOutlined />;
    default:
      return <TagOutlined />;
  }
}

type RowActions = {
  onDone: (item: LedgerListItem) => void;
  onCancel: (item: LedgerListItem) => void;
  onReopen: (item: LedgerListItem) => void;
  onEdit: (item: LedgerListItem) => void;
};

const LedgerItemRow: React.FC<{ item: LedgerListItem; actions: RowActions }> = ({
  item,
  actions,
}) => {
  const { t } = useTranslation();
  const terminal = isTerminalStatus(item.status);
  const timeText = formatAgendaTime(item.timeAt);

  return (
    <Flex
      data-testid={`ledger-item-${item.id}`}
      align="center"
      justify="space-between"
      gap={8}
      style={{
        padding: "6px 8px",
        borderRadius: 8,
        border: "1px solid var(--ant-color-border-secondary, rgba(0,0,0,0.06))",
      }}
    >
      <Flex vertical gap={4} style={{ minWidth: 0, flex: 1 }}>
        {/* The title itself is the edit trigger — a real <button>, instead
            of making the whole row a role=button container with nested
            action buttons inside/beside it (#167). */}
        <button
          type="button"
          className="lotus-ledger-item-title-button"
          aria-label={`${t("ledger.actions.edit")}: ${item.title}`}
          onClick={() => actions.onEdit(item)}
          style={{
            all: "unset",
            cursor: "pointer",
            alignSelf: "flex-start",
            maxWidth: "100%",
            borderRadius: 4,
          }}
        >
          <Text strong ellipsis delete={terminal} style={{ fontSize: 13 }}>
            {item.title}
          </Text>
        </button>
        <Flex gap={4} align="center" wrap="wrap">
          <Tag
            icon={kindIcon(item.kind)}
            color={kindTagColor(item.kind)}
            style={{ marginInlineEnd: 0 }}
          >
            {t(`ledger.kinds.${item.kind}`, item.kind)}
          </Tag>
          <Tag color={priorityTagColor(item.priority)} style={{ marginInlineEnd: 0 }}>
            {t(`ledger.priorities.${item.priority}`, item.priority)}
          </Tag>
          <Tag color={statusTagColor(item.status)} style={{ marginInlineEnd: 0 }}>
            {t(`ledger.statuses.${item.status}`, item.status)}
          </Tag>
          {timeText ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {timeText}
            </Text>
          ) : null}
        </Flex>
      </Flex>

      <Flex gap={2} align="center" style={{ flexShrink: 0 }}>
        {terminal ? (
          <Tooltip title={t("ledger.actions.reopen")}>
            <Button
              size="small"
              type="text"
              icon={<RedoOutlined />}
              aria-label={t("ledger.actions.reopen")}
              onClick={() => actions.onReopen(item)}
            />
          </Tooltip>
        ) : (
          <>
            <Tooltip title={t("ledger.actions.done")}>
              <Button
                size="small"
                type="text"
                icon={<CheckOutlined />}
                aria-label={t("ledger.actions.done")}
                onClick={() => actions.onDone(item)}
              />
            </Tooltip>
            <Tooltip title={t("ledger.actions.cancel")}>
              <Button
                size="small"
                type="text"
                danger
                icon={<StopOutlined />}
                aria-label={t("ledger.actions.cancel")}
                onClick={() => actions.onCancel(item)}
              />
            </Tooltip>
          </>
        )}
        <Tooltip title={t("ledger.actions.edit")}>
          <Button
            size="small"
            type="text"
            icon={<EditOutlined />}
            aria-label={t("ledger.actions.edit")}
            onClick={() => actions.onEdit(item)}
          />
        </Tooltip>
      </Flex>
    </Flex>
  );
};

const AgendaSection: React.FC<{
  titleText: string;
  items: LedgerListItem[];
  actions: RowActions;
}> = ({ titleText, items, actions }) => {
  if (items.length === 0) {
    return null;
  }
  return (
    <Flex vertical gap={6}>
      <Text type="secondary" strong style={{ fontSize: 12, textTransform: "uppercase" }}>
        {titleText} ({items.length})
      </Text>
      {items.map((item) => (
        <LedgerItemRow key={item.id} item={item} actions={actions} />
      ))}
    </Flex>
  );
};

interface EditModalState {
  open: boolean;
  target: { id: string; project_key?: string; initial: LedgerEditFormValues } | null;
  saving: boolean;
}

interface CancelModalState {
  open: boolean;
  target: LedgerListItem | null;
  reason: string;
  saving: boolean;
}

export const LedgerDrawer: React.FC = () => {
  const { t } = useTranslation();
  const [msgApi, contextHolder] = message.useMessage();
  const isMobile = useIsMobile();

  const isOpen = useLedgerViewStore((s) => s.isOpen);
  const view = useLedgerViewStore((s) => s.view);
  const close = useLedgerViewStore((s) => s.close);
  const setView = useLedgerViewStore((s) => s.setView);
  const setBadgeCount = useLedgerViewStore((s) => s.setBadgeCount);

  const [agenda, setAgenda] = useState<AgendaSnapshot | null>(null);
  const [agendaLoading, setAgendaLoading] = useState(false);

  const [records, setRecords] = useState<LedgerRecord[]>([]);
  const [recordsMeta, setRecordsMeta] = useState<{ returned: number; matched: number } | null>(
    null,
  );
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<RecordStatus[]>([]);
  const [kindFilter, setKindFilter] = useState<RecordKind[]>([]);
  const [includeTerminal, setIncludeTerminal] = useState(false);

  const [quickAddTitle, setQuickAddTitle] = useState("");
  const [quickAddDue, setQuickAddDue] = useState("");
  const [quickAddSaving, setQuickAddSaving] = useState(false);

  const [editModal, setEditModal] = useState<EditModalState>({
    open: false,
    target: null,
    saving: false,
  });
  const [cancelModal, setCancelModal] = useState<CancelModalState>({
    open: false,
    target: null,
    reason: "",
    saving: false,
  });
  const [editForm] = Form.useForm<LedgerEditFormValues>();

  const refreshAgenda = useCallback(
    async (opts?: { silent?: boolean }) => {
      setAgendaLoading(true);
      try {
        const snapshot = await ledgerClient.getAgenda();
        setAgenda(snapshot);
        setBadgeCount(agendaBadgeCount(snapshot));
      } catch (e) {
        console.error("[Ledger] Failed to load agenda:", e);
        if (!opts?.silent) {
          msgApi.error(t("ledger.toasts.loadFailed"));
        }
      } finally {
        setAgendaLoading(false);
      }
    },
    [msgApi, setBadgeCount, t],
  );

  const refreshRecords = useCallback(async () => {
    setRecordsLoading(true);
    try {
      const resp = await ledgerClient.listRecords({
        status: statusFilter.length > 0 ? statusFilter : undefined,
        kind: kindFilter.length > 0 ? kindFilter : undefined,
        includeTerminal,
        limit: 50,
      });
      setRecords(resp.records || []);
      setRecordsMeta({ returned: resp.returned, matched: resp.matched });
    } catch (e) {
      console.error("[Ledger] Failed to load records:", e);
      msgApi.error(t("ledger.toasts.recordsLoadFailed"));
    } finally {
      setRecordsLoading(false);
    }
  }, [includeTerminal, kindFilter, msgApi, statusFilter, t]);

  // Initial fetch keeps the trigger badge meaningful before first open.
  useEffect(() => {
    void refreshAgenda({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh agenda whenever the drawer opens.
  useEffect(() => {
    if (isOpen) {
      void refreshAgenda();
    }
  }, [isOpen, refreshAgenda]);

  // Load records when the records view is visible (and filters change).
  useEffect(() => {
    if (isOpen && view === "records") {
      void refreshRecords();
    }
  }, [isOpen, view, refreshRecords]);

  const refreshAll = useCallback(async () => {
    await refreshAgenda();
    if (view === "records") {
      await refreshRecords();
    }
  }, [refreshAgenda, refreshRecords, view]);

  const runTransition = useCallback(
    async (item: LedgerListItem, patch: PatchRecordRequest, successKey: string) => {
      try {
        await ledgerClient.patchRecord(item.id, patch, item.project_key);
        msgApi.success(t(successKey));
      } catch (e) {
        console.error("[Ledger] Failed to update record:", e);
        msgApi.error(t("ledger.toasts.updateFailed"));
        return;
      }
      await refreshAgenda({ silent: true });
      if (view === "records") {
        await refreshRecords();
      }
    },
    [msgApi, refreshAgenda, refreshRecords, t, view],
  );

  const rowActions: RowActions = {
    onDone: (item) => void runTransition(item, { status: "done" }, "ledger.toasts.done"),
    onCancel: (item) => setCancelModal({ open: true, target: item, reason: "", saving: false }),
    onReopen: (item) => void runTransition(item, { status: "open" }, "ledger.toasts.reopened"),
    onEdit: (item) => {
      const initial = listItemToEditValues(item);
      setEditModal({
        open: true,
        target: { id: item.id, project_key: item.project_key, initial },
        saving: false,
      });
      editForm.setFieldsValue(initial);
    },
  };

  const handleQuickAdd = useCallback(async () => {
    const req = buildQuickAddRequest(quickAddTitle, quickAddDue);
    if (!req) {
      msgApi.error(t("ledger.quickAdd.titleRequired"));
      return;
    }
    setQuickAddSaving(true);
    try {
      await ledgerClient.upsertRecord(req);
      msgApi.success(t("ledger.quickAdd.added"));
      setQuickAddTitle("");
      setQuickAddDue("");
      await refreshAgenda({ silent: true });
      if (view === "records") {
        await refreshRecords();
      }
    } catch (e) {
      console.error("[Ledger] Failed to add todo:", e);
      msgApi.error(t("ledger.quickAdd.addFailed"));
    } finally {
      setQuickAddSaving(false);
    }
  }, [msgApi, quickAddDue, quickAddTitle, refreshAgenda, refreshRecords, t, view]);

  const handleEditSubmit = useCallback(
    async (values: LedgerEditFormValues) => {
      const target = editModal.target;
      if (!target) {
        return;
      }
      const req = buildEditUpsert(target.id, target.initial, values);
      if (!req) {
        setEditModal({ open: false, target: null, saving: false });
        return;
      }
      setEditModal((s) => ({ ...s, saving: true }));
      try {
        await ledgerClient.upsertRecord(req);
        msgApi.success(t("ledger.toasts.updated"));
        setEditModal({ open: false, target: null, saving: false });
        await refreshAgenda({ silent: true });
        if (view === "records") {
          await refreshRecords();
        }
      } catch (e) {
        console.error("[Ledger] Failed to save record:", e);
        msgApi.error(t("ledger.toasts.updateFailed"));
        setEditModal((s) => ({ ...s, saving: false }));
      }
    },
    [editModal.target, msgApi, refreshAgenda, refreshRecords, t, view],
  );

  const handleCancelConfirm = useCallback(async () => {
    const target = cancelModal.target;
    if (!target) {
      return;
    }
    setCancelModal((s) => ({ ...s, saving: true }));
    const reason = cancelModal.reason.trim();
    try {
      await ledgerClient.patchRecord(
        target.id,
        { status: "cancelled", ...(reason ? { reason } : {}) },
        target.project_key,
      );
      msgApi.success(t("ledger.toasts.cancelled"));
      setCancelModal({ open: false, target: null, reason: "", saving: false });
      await refreshAgenda({ silent: true });
      if (view === "records") {
        await refreshRecords();
      }
    } catch (e) {
      console.error("[Ledger] Failed to cancel record:", e);
      msgApi.error(t("ledger.toasts.updateFailed"));
      setCancelModal((s) => ({ ...s, saving: false }));
    }
  }, [cancelModal.reason, cancelModal.target, msgApi, refreshAgenda, refreshRecords, t, view]);

  const agendaEmpty =
    !agenda ||
    (agenda.overdue.length === 0 &&
      agenda.today.length === 0 &&
      agenda.upcoming.length === 0 &&
      agenda.undated.length === 0);

  const kindOptions = KNOWN_KINDS.map((kind) => ({
    value: kind,
    label: t(`ledger.kinds.${kind}`, kind),
  }));
  const statusOptions = ALL_STATUSES.map((status) => ({
    value: status,
    label: t(`ledger.statuses.${status}`, status),
  }));
  const priorityOptions = PRIORITIES.map((priority) => ({
    value: priority,
    label: t(`ledger.priorities.${priority}`, priority),
  }));

  return (
    <>
      {contextHolder}
      <Drawer
        title={t("ledger.title")}
        placement="right"
        width={isMobile ? "100%" : 440}
        open={isOpen}
        onClose={close}
        extra={
          <Tooltip title={t("ledger.actions.refresh")}>
            <Button
              size="small"
              type="text"
              icon={<ReloadOutlined />}
              aria-label={t("ledger.actions.refresh")}
              loading={agendaLoading || recordsLoading}
              onClick={() => void refreshAll()}
            />
          </Tooltip>
        }
        styles={{ body: { padding: 16 } }}
      >
        <Flex vertical gap={12}>
          <Segmented
            block
            value={view}
            onChange={(value) => setView(value as LedgerViewKey)}
            options={[
              { value: "agenda", label: t("ledger.views.agenda") },
              { value: "records", label: t("ledger.views.records") },
            ]}
          />

          {view === "agenda" ? (
            <>
              <Flex gap={6}>
                <Input
                  size="small"
                  value={quickAddTitle}
                  onChange={(e) => setQuickAddTitle(e.target.value)}
                  placeholder={t("ledger.quickAdd.placeholder")}
                  aria-label={t("ledger.quickAdd.placeholder")}
                  onPressEnter={() => void handleQuickAdd()}
                  style={{ flex: 1 }}
                />
                <Input
                  size="small"
                  type="date"
                  value={quickAddDue}
                  onChange={(e) => setQuickAddDue(e.target.value)}
                  aria-label={t("ledger.quickAdd.dueLabel")}
                  style={{ width: 130 }}
                />
                <Tooltip title={t("ledger.quickAdd.add")}>
                  <Button
                    size="small"
                    type="primary"
                    icon={<PlusOutlined />}
                    aria-label={t("ledger.quickAdd.add")}
                    loading={quickAddSaving}
                    onClick={() => void handleQuickAdd()}
                  />
                </Tooltip>
              </Flex>

              {agendaLoading && !agenda ? (
                <Flex justify="center" style={{ padding: 24 }}>
                  <Spin />
                </Flex>
              ) : agendaEmpty ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t("ledger.empty.agenda")}
                />
              ) : (
                <Flex vertical gap={14}>
                  <AgendaSection
                    titleText={t("ledger.sections.overdue")}
                    items={(agenda?.overdue ?? []).map(agendaItemToListItem)}
                    actions={rowActions}
                  />
                  <AgendaSection
                    titleText={t("ledger.sections.today")}
                    items={(agenda?.today ?? []).map(agendaItemToListItem)}
                    actions={rowActions}
                  />
                  <AgendaSection
                    titleText={t("ledger.sections.upcoming")}
                    items={(agenda?.upcoming ?? []).map(agendaItemToListItem)}
                    actions={rowActions}
                  />
                  <AgendaSection
                    titleText={t("ledger.sections.undated")}
                    items={(agenda?.undated ?? []).map(agendaItemToListItem)}
                    actions={rowActions}
                  />
                </Flex>
              )}
            </>
          ) : (
            <>
              <Flex gap={6} wrap="wrap" align="center">
                <Select
                  mode="multiple"
                  size="small"
                  allowClear
                  value={statusFilter}
                  onChange={(value) => setStatusFilter(value as RecordStatus[])}
                  options={statusOptions}
                  placeholder={t("ledger.filters.status")}
                  aria-label={t("ledger.filters.status")}
                  style={{ minWidth: 140, flex: 1 }}
                  maxTagCount="responsive"
                />
                <Select
                  mode="multiple"
                  size="small"
                  allowClear
                  value={kindFilter}
                  onChange={(value) => setKindFilter(value as RecordKind[])}
                  options={kindOptions}
                  placeholder={t("ledger.filters.kind")}
                  aria-label={t("ledger.filters.kind")}
                  style={{ minWidth: 130, flex: 1 }}
                  maxTagCount="responsive"
                />
                <Flex gap={4} align="center">
                  <Switch
                    size="small"
                    checked={includeTerminal}
                    onChange={setIncludeTerminal}
                    aria-label={t("ledger.filters.includeTerminal")}
                  />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t("ledger.filters.includeTerminal")}
                  </Text>
                </Flex>
              </Flex>

              {recordsLoading && records.length === 0 ? (
                <Flex justify="center" style={{ padding: 24 }}>
                  <Spin />
                </Flex>
              ) : records.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t("ledger.empty.records")}
                />
              ) : (
                <Flex vertical gap={6}>
                  {recordsMeta ? (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {t("ledger.filters.matched", {
                        returned: recordsMeta.returned,
                        matched: recordsMeta.matched,
                      })}
                    </Text>
                  ) : null}
                  {records.map((record) => (
                    <LedgerItemRow
                      key={record.id}
                      item={recordToListItem(record)}
                      actions={rowActions}
                    />
                  ))}
                </Flex>
              )}
            </>
          )}
        </Flex>
      </Drawer>

      <Modal
        title={t("ledger.editModal.title")}
        open={editModal.open}
        onCancel={() => setEditModal({ open: false, target: null, saving: false })}
        okText={t("ledger.editModal.save")}
        confirmLoading={editModal.saving}
        onOk={() => editForm.submit()}
        forceRender
        zIndex={1100}
      >
        <Form<LedgerEditFormValues> form={editForm} layout="vertical" onFinish={handleEditSubmit}>
          <Form.Item
            label={t("ledger.editModal.titleLabel")}
            name="title"
            rules={[{ required: true, message: t("ledger.editModal.titleRequired") }]}
          >
            <Input />
          </Form.Item>
          <Flex gap={12}>
            <Form.Item label={t("ledger.editModal.kindLabel")} name="kind" style={{ flex: 1 }}>
              <Select options={kindOptions} />
            </Form.Item>
            <Form.Item
              label={t("ledger.editModal.priorityLabel")}
              name="priority"
              style={{ flex: 1 }}
            >
              <Select options={priorityOptions} />
            </Form.Item>
          </Flex>
          <Form.Item label={t("ledger.editModal.dueAtLabel")} name="due_at">
            <Input placeholder={t("ledger.editModal.dueAtPlaceholder")} />
          </Form.Item>
          <Form.Item label={t("ledger.editModal.tagsLabel")} name="tags">
            <Input placeholder={t("ledger.editModal.tagsPlaceholder")} />
          </Form.Item>
          <Form.Item label={t("ledger.editModal.bodyLabel")} name="body">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("ledger.cancelModal.title")}
        open={cancelModal.open}
        onCancel={() => setCancelModal({ open: false, target: null, reason: "", saving: false })}
        okText={t("ledger.cancelModal.confirm")}
        okButtonProps={{ danger: true }}
        confirmLoading={cancelModal.saving}
        onOk={() => void handleCancelConfirm()}
        zIndex={1100}
      >
        <Flex vertical gap={8}>
          <Text ellipsis>{cancelModal.target?.title}</Text>
          <Input.TextArea
            rows={2}
            value={cancelModal.reason}
            onChange={(e) => setCancelModal((s) => ({ ...s, reason: e.target.value }))}
            placeholder={t("ledger.cancelModal.reasonPlaceholder")}
            aria-label={t("ledger.cancelModal.reasonLabel")}
          />
        </Flex>
      </Modal>
    </>
  );
};

export default LedgerDrawer;
