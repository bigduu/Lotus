import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  LockOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Empty,
  Flex,
  Input,
  List,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  message,
  theme,
} from "antd";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ServiceFactory } from "@services/common/ServiceFactory";
import { useAppStore } from "@shared/store/appStore";
import { WorkflowManagerService } from "../../../ChatPage/services/WorkflowManagerService";
import {
  NegotiatedWorkflowCatalogAdapter,
  BambooWorkflowMigrationClient,
  type LegacyWorkflowManagementClient,
  type WorkflowCatalogAdapter,
  type WorkflowCatalogItem,
  type WorkflowCatalogView,
  type WorkflowMigrationClient,
  type WorkflowSource,
  type WorkflowStatus,
} from "../../../../features/workflows";

const { Text, Title } = Typography;
const { useToken } = theme;

const defaultCatalogAdapter = new NegotiatedWorkflowCatalogAdapter();
const defaultMigrationClient = new BambooWorkflowMigrationClient();
const defaultLegacyManager: LegacyWorkflowManagementClient = {
  getWorkflow: (name) => WorkflowManagerService.getInstance().getWorkflow(name),
  saveWorkflow: async (name, content) => {
    await ServiceFactory.getInstance().saveWorkflow(name, content);
  },
  deleteWorkflow: async (name) => {
    await ServiceFactory.getInstance().deleteWorkflow(name);
  },
};

type FilterValue<T extends string> = T | "all";

export interface SystemSettingsWorkflowsTabProps {
  catalogAdapter?: WorkflowCatalogAdapter;
  legacyManager?: LegacyWorkflowManagementClient;
  migrationClient?: WorkflowMigrationClient;
  sessionId?: string | null;
}

const isSafeWorkflowName = (name: string): boolean =>
  Boolean(name) && !name.includes("/") && !name.includes("\\") && !name.includes("..");

const SystemSettingsWorkflowsTab: React.FC<SystemSettingsWorkflowsTabProps> = ({
  catalogAdapter = defaultCatalogAdapter,
  legacyManager = defaultLegacyManager,
  migrationClient = defaultMigrationClient,
  sessionId,
}) => {
  const { t } = useTranslation();
  const { token } = useToken();
  const currentSessionId = useAppStore((state) => state.currentSessionId);
  const resolvedSessionId = sessionId === undefined ? currentSessionId : sessionId;
  const [msgApi, contextHolder] = message.useMessage();
  const [catalog, setCatalog] = useState<WorkflowCatalogView | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<FilterValue<WorkflowSource>>("all");
  const [status, setStatus] = useState<FilterValue<WorkflowStatus>>("all");
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isEditorLoading, setIsEditorLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [migratingWorkflowId, setMigratingWorkflowId] = useState<string | null>(null);
  const [editingOriginalName, setEditingOriginalName] = useState<string | null>(null);
  const [editorName, setEditorName] = useState("");
  const [editorContent, setEditorContent] = useState("");
  const loadGeneration = useRef(0);

  const loadCatalog = useCallback(
    async (signal?: AbortSignal) => {
      const generation = ++loadGeneration.current;
      setIsLoading(true);
      setLoadError(null);
      try {
        const nextCatalog = await catalogAdapter.load({ sessionId: resolvedSessionId, signal });
        if (signal?.aborted || generation !== loadGeneration.current) return;
        setCatalog(nextCatalog);
      } catch (error) {
        if (signal?.aborted || generation !== loadGeneration.current) return;
        setCatalog(null);
        setLoadError(
          error instanceof Error ? error.message : t("settings.workflowsTab.loadFailed"),
        );
      } finally {
        if (!signal?.aborted && generation === loadGeneration.current) setIsLoading(false);
      }
    },
    [catalogAdapter, resolvedSessionId, t],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadCatalog(controller.signal);
    return () => controller.abort();
  }, [loadCatalog]);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (catalog?.items ?? []).filter((item) => {
      if (
        source !== "all" &&
        item.source !== source &&
        !item.shadowedCandidates?.some((candidate) => candidate.source === source)
      ) {
        return false;
      }
      if (
        status !== "all" &&
        item.status !== status &&
        !(status === "shadowed" && item.shadowedCandidates && item.shadowedCandidates.length > 0)
      ) {
        return false;
      }
      if (!query) return true;
      return [item.name, item.id, item.description, item.argumentHint]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [catalog?.items, search, source, status]);

  const openLegacyCreate = useCallback(() => {
    setEditingOriginalName(null);
    setEditorName("");
    setEditorContent("");
    setIsEditorOpen(true);
  }, []);

  const openLegacyEdit = useCallback(
    async (item: WorkflowCatalogItem) => {
      setEditingOriginalName(item.id);
      setEditorName(item.id);
      setEditorContent("");
      setIsEditorOpen(true);
      setIsEditorLoading(true);
      try {
        const workflow = await legacyManager.getWorkflow(item.id);
        setEditorName(workflow.name);
        setEditorContent(workflow.content);
      } catch (error) {
        msgApi.error(
          error instanceof Error ? error.message : t("settings.workflowsTab.loadContentFailed"),
        );
        setIsEditorOpen(false);
      } finally {
        setIsEditorLoading(false);
      }
    },
    [legacyManager, msgApi, t],
  );

  const saveLegacyWorkflow = useCallback(async () => {
    const normalizedName = editorName.trim();
    if (!isSafeWorkflowName(normalizedName)) {
      msgApi.error(t("settings.workflowsTab.invalidName"));
      return;
    }
    if (!editingOriginalName && catalog?.items.some((item) => item.id === normalizedName)) {
      msgApi.error(t("settings.workflowsTab.nameAlreadyExists"));
      return;
    }
    setIsSaving(true);
    try {
      await legacyManager.saveWorkflow(normalizedName, editorContent);
      msgApi.success(t("settings.workflowsTab.saved"));
      setIsEditorOpen(false);
      await loadCatalog();
    } catch (error) {
      msgApi.error(error instanceof Error ? error.message : t("settings.workflowsTab.saveFailed"));
    } finally {
      setIsSaving(false);
    }
  }, [
    catalog?.items,
    editingOriginalName,
    editorContent,
    editorName,
    legacyManager,
    loadCatalog,
    msgApi,
    t,
  ]);

  const deleteLegacyWorkflow = useCallback(
    async (item: WorkflowCatalogItem) => {
      try {
        await legacyManager.deleteWorkflow(item.id);
        msgApi.success(t("settings.workflowsTab.deleted"));
        await loadCatalog();
      } catch (error) {
        msgApi.error(
          error instanceof Error ? error.message : t("settings.workflowsTab.deleteFailed"),
        );
      }
    },
    [legacyManager, loadCatalog, msgApi, t],
  );

  const migrateLegacyWorkflow = useCallback(
    async (item: WorkflowCatalogItem) => {
      const trustedSessionId = resolvedSessionId?.trim();
      if (!trustedSessionId) {
        msgApi.error(t("settings.workflowsTab.migrationNeedsSession"));
        return;
      }
      setMigratingWorkflowId(item.id);
      try {
        const result = await migrationClient.migrate(item.id, trustedSessionId);
        msgApi.success(
          t(
            result.outcome === "already_migrated"
              ? "settings.workflowsTab.alreadyMigrated"
              : "settings.workflowsTab.migrated",
          ),
        );
        await loadCatalog();
      } catch (error) {
        msgApi.error(
          error instanceof Error ? error.message : t("settings.workflowsTab.migrationFailed"),
        );
      } finally {
        setMigratingWorkflowId(null);
      }
    },
    [loadCatalog, migrationClient, msgApi, resolvedSessionId, t],
  );

  const renderWorkflow = (item: WorkflowCatalogItem) => (
    <List.Item key={item.id}>
      <article aria-labelledby={`workflow-library-${item.id}`} style={{ width: "100%" }}>
        <Flex justify="space-between" align="flex-start" gap={token.marginMD} wrap>
          <Space direction="vertical" size={token.marginXXS} style={{ minWidth: 0, flex: 1 }}>
            <Flex align="center" gap={token.marginXS} wrap>
              <Title id={`workflow-library-${item.id}`} level={5} style={{ margin: 0 }}>
                {item.name}
              </Title>
              {item.legacy ? (
                <Tag color="orange">{t("settings.workflowsTab.legacy")}</Tag>
              ) : (
                <Tag color="purple">{t(`settings.workflowsTab.kind.${item.kind}`)}</Tag>
              )}
              <Tag>{t(`settings.workflowsTab.source.${item.source}`)}</Tag>
              <Tag color={item.status === "valid" ? "success" : "warning"}>
                {t(`settings.workflowsTab.status.${item.status}`)}
              </Tag>
              {item.migrationStatus && (
                <Tag color={item.migrationStatus === "available" ? "warning" : "success"}>
                  {t(`settings.workflowsTab.migrationStatus.${item.migrationStatus}`)}
                </Tag>
              )}
              <Tag color="geekblue">
                {t(`settings.workflowsTab.invocation.${item.invocationPolicy}`)}
              </Tag>
              {item.readOnly && (
                <Tag icon={<LockOutlined />}>{t("settings.workflowsTab.readOnly")}</Tag>
              )}
            </Flex>
            <Text type="secondary">{item.description}</Text>
            {item.argumentHint && (
              <Text>
                {t("settings.workflowsTab.arguments")}: <Text code>{item.argumentHint}</Text>
              </Text>
            )}
            {(item.version || item.revision !== undefined) && (
              <Text type="secondary">
                {[
                  item.version
                    ? t("settings.workflowsTab.version", { version: item.version })
                    : null,
                  item.revision !== undefined
                    ? t("settings.workflowsTab.revision", { revision: item.revision })
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            )}
            {item.lastError && <Text type="danger">{item.lastError}</Text>}
            {item.shadowedCandidates && item.shadowedCandidates.length > 0 && (
              <Flex
                gap={token.marginXS}
                wrap
                aria-label={t("settings.workflowsTab.shadowedCandidates")}
              >
                <Text type="secondary">{t("settings.workflowsTab.shadowedCandidates")}:</Text>
                {item.shadowedCandidates.map((candidate, index) => (
                  <Tag key={`${candidate.source}-${index}`} color="warning">
                    {t(`settings.workflowsTab.source.${candidate.source}`)} ·{" "}
                    {t(`settings.workflowsTab.status.${candidate.status}`)}
                    {candidate.legacy ? ` · ${t("settings.workflowsTab.legacy")}` : ""}
                    {candidate.migrationStatus
                      ? ` · ${t(`settings.workflowsTab.migrationStatus.${candidate.migrationStatus}`)}`
                      : ""}
                    {candidate.lastError ? ` · ${candidate.lastError}` : ""}
                  </Tag>
                ))}
              </Flex>
            )}
          </Space>
          <Space wrap>
            {item.migrationStatus === "available" && (
              <Button
                icon={<SwapOutlined />}
                loading={migratingWorkflowId === item.id}
                disabled={!resolvedSessionId?.trim()}
                onClick={() => void migrateLegacyWorkflow(item)}
                aria-label={t("settings.workflowsTab.migrateWorkflow", { name: item.name })}
              >
                {t("settings.workflowsTab.migrate")}
              </Button>
            )}
            <Button
              icon={<CopyOutlined />}
              disabled={!catalog?.capabilities.clone}
              aria-label={t("settings.workflowsTab.cloneWorkflow", { name: item.name })}
            >
              {t("settings.workflowsTab.clone")}
            </Button>
            <Button
              icon={<EditOutlined />}
              disabled={item.readOnly || !catalog?.capabilities.edit}
              onClick={() => void openLegacyEdit(item)}
              aria-label={t("settings.workflowsTab.editWorkflow", { name: item.name })}
            >
              {t("settings.workflowsTab.edit")}
            </Button>
            <Button
              icon={<PlayCircleOutlined />}
              disabled={!catalog?.capabilities.run}
              aria-label={t("settings.workflowsTab.runWorkflow", { name: item.name })}
            >
              {t("settings.workflowsTab.run")}
            </Button>
            {catalog?.capabilities.mode === "legacy" && !item.readOnly && (
              <Button
                danger
                icon={<DeleteOutlined />}
                onClick={() => void deleteLegacyWorkflow(item)}
                aria-label={t("settings.workflowsTab.deleteWorkflow", { name: item.name })}
              >
                {t("settings.workflowsTab.delete")}
              </Button>
            )}
          </Space>
        </Flex>
      </article>
    </List.Item>
  );

  return (
    <div style={{ padding: token.paddingLG }}>
      {contextHolder}
      <Card
        title={t("settings.workflowsTab.title")}
        extra={
          <Space>
            {catalog?.capabilities.mode === "legacy" && (
              <Button
                icon={<PlusOutlined />}
                onClick={openLegacyCreate}
                aria-label={t("settings.workflowsTab.newWorkflow")}
              >
                {t("settings.workflowsTab.newWorkflow")}
              </Button>
            )}
            <Button
              icon={<ReloadOutlined />}
              onClick={() => void loadCatalog()}
              loading={isLoading}
              aria-label={t("settings.workflowsTab.refresh")}
            >
              {t("settings.workflowsTab.refresh")}
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size={token.marginLG} style={{ width: "100%" }}>
          <Text type="secondary">{t("settings.workflowsTab.description")}</Text>

          <Flex gap={token.marginSM} wrap role="search">
            <Input.Search
              allowClear
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("settings.workflowsTab.searchPlaceholder")}
              aria-label={t("settings.workflowsTab.searchLabel")}
              style={{ minWidth: 220, flex: 1 }}
            />
            <Select
              value={source}
              onChange={setSource}
              aria-label={t("settings.workflowsTab.sourceFilter")}
              options={[
                { value: "all", label: t("settings.workflowsTab.allSources") },
                ...(
                  [
                    "builtin",
                    "project",
                    "workspace",
                    "user",
                    "plugin",
                    "legacy",
                  ] as WorkflowSource[]
                ).map((value) => ({
                  value,
                  label: t(`settings.workflowsTab.source.${value}`),
                })),
              ]}
              style={{ minWidth: 140 }}
            />
            <Select
              value={status}
              onChange={setStatus}
              aria-label={t("settings.workflowsTab.statusFilter")}
              options={[
                { value: "all", label: t("settings.workflowsTab.allStatuses") },
                ...(["valid", "invalid", "degraded", "shadowed"] as WorkflowStatus[]).map(
                  (value) => ({
                    value,
                    label: t(`settings.workflowsTab.status.${value}`),
                  }),
                ),
              ]}
              style={{ minWidth: 140 }}
            />
          </Flex>

          {catalog && (
            <Text type="secondary">
              {t("settings.workflowsTab.catalogMode", {
                mode: t(`settings.workflowsTab.mode.${catalog.capabilities.mode}`),
              })}
            </Text>
          )}

          {catalog && catalog.diagnostics.length > 0 && (
            <Alert
              type="warning"
              showIcon
              message={t("settings.workflowsTab.partialInvalid", {
                count: catalog.diagnostics.length,
              })}
              description={catalog.diagnostics.map((diagnostic) => diagnostic.message).join(" · ")}
            />
          )}

          {loadError && (
            <Alert
              type="error"
              showIcon
              message={t("settings.workflowsTab.loadFailed")}
              description={loadError}
            />
          )}

          {isLoading ? (
            <Flex justify="center" style={{ padding: token.paddingXL }}>
              <Spin aria-label={t("settings.workflowsTab.loading")} />
            </Flex>
          ) : (
            <List
              dataSource={filteredItems}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      search || source !== "all" || status !== "all"
                        ? t("settings.workflowsTab.noMatches")
                        : t("settings.workflowsTab.empty")
                    }
                  />
                ),
              }}
              renderItem={renderWorkflow}
            />
          )}
        </Space>
      </Card>
      <Modal
        open={isEditorOpen}
        title={t("settings.workflowsTab.legacyEditorTitle")}
        onCancel={() => setIsEditorOpen(false)}
        onOk={() => void saveLegacyWorkflow()}
        okText={t("settings.workflowsTab.save")}
        okButtonProps={{
          icon: <SaveOutlined />,
          loading: isSaving,
          "aria-label": t("settings.workflowsTab.save"),
        }}
      >
        <Space direction="vertical" size={token.marginSM} style={{ width: "100%" }}>
          <Input
            value={editorName}
            onChange={(event) => setEditorName(event.target.value)}
            disabled={Boolean(editingOriginalName)}
            placeholder={t("settings.workflowsTab.namePlaceholder")}
            aria-label={t("settings.workflowsTab.namePlaceholder")}
          />
          <Input.TextArea
            value={editorContent}
            onChange={(event) => setEditorContent(event.target.value)}
            disabled={isEditorLoading}
            autoSize={{ minRows: 12 }}
            placeholder={t("settings.workflowsTab.contentPlaceholder")}
            aria-label={t("settings.workflowsTab.contentPlaceholder")}
          />
        </Space>
      </Modal>
    </div>
  );
};

export default SystemSettingsWorkflowsTab;
