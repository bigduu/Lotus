import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Flex, Input, List, Space, Typography, message, theme } from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import {
  WorkflowManagerService,
  type WorkflowMetadata,
} from "../../../ChatPage/services/WorkflowManagerService";
import { ServiceFactory } from "../../../../services/common/ServiceFactory";
import { useTranslation } from "react-i18next";

const { Text } = Typography;
const { TextArea } = Input;
const { useToken } = theme;

const isSafeWorkflowName = (name: string) => {
  if (!name) return false;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    return false;
  }
  return true;
};

const SystemSettingsWorkflowsTab: React.FC = () => {
  const { t } = useTranslation();
  const { token } = useToken();
  const [msgApi, contextHolder] = message.useMessage();
  const [workflows, setWorkflows] = useState<WorkflowMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowMetadata | null>(null);
  const [editorName, setEditorName] = useState("");
  const [editorContent, setEditorContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  const workflowService = useMemo(() => WorkflowManagerService.getInstance(), []);

  const loadWorkflows = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await workflowService.listWorkflows();
      setWorkflows(result);
      return result;
    } catch {
      msgApi.error(t("settings.workflowsTab.loadFailed"));
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [msgApi, t, workflowService]);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  const handleSelectWorkflow = useCallback(
    async (workflow: WorkflowMetadata) => {
      setSelectedWorkflow(workflow);
      setEditorName(workflow.name);
      setIsDirty(false);
      setIsLoadingContent(true);
      try {
        const result = await workflowService.getWorkflow(workflow.name);
        setEditorContent(result.content ?? "");
      } catch {
        msgApi.error(t("settings.workflowsTab.loadContentFailed"));
        setEditorContent("");
      } finally {
        setIsLoadingContent(false);
      }
    },
    [msgApi, t, workflowService],
  );

  const handleCreateNew = () => {
    setSelectedWorkflow(null);
    setEditorName("");
    setEditorContent("");
    setIsDirty(false);
  };

  const handleSave = useCallback(async () => {
    if (!isSafeWorkflowName(editorName)) {
      msgApi.error(t("settings.workflowsTab.invalidName"));
      return;
    }
    const exists = workflows.some((workflow) => workflow.name === editorName);
    if (!selectedWorkflow && exists) {
      msgApi.error(t("settings.workflowsTab.nameAlreadyExists"));
      return;
    }

    setIsSaving(true);
    try {
      const serviceFactory = ServiceFactory.getInstance();
      await serviceFactory.saveWorkflow(editorName, editorContent);
      msgApi.success(t("settings.workflowsTab.saved"));
      setIsDirty(false);
      const updatedList = await loadWorkflows();
      const updated = updatedList.find((item) => item.name === editorName);
      if (updated) {
        setSelectedWorkflow(updated);
      }
    } catch (error) {
      msgApi.error(error instanceof Error ? error.message : t("settings.workflowsTab.saveFailed"));
    } finally {
      setIsSaving(false);
    }
  }, [editorContent, editorName, loadWorkflows, msgApi, selectedWorkflow, t, workflows]);

  const handleDelete = useCallback(
    async (workflow: WorkflowMetadata) => {
      try {
        const serviceFactory = ServiceFactory.getInstance();
        await serviceFactory.deleteWorkflow(workflow.name);
        msgApi.success(t("settings.workflowsTab.deleted"));
        if (selectedWorkflow?.name === workflow.name) {
          handleCreateNew();
        }
        await loadWorkflows();
      } catch (error) {
        msgApi.error(
          error instanceof Error ? error.message : t("settings.workflowsTab.deleteFailed"),
        );
      }
    },
    [loadWorkflows, msgApi, selectedWorkflow, t],
  );

  return (
    <div style={{ padding: "24px" }}>
      {contextHolder}
      <Card
        title={t("settings.workflowsTab.title")}
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={loadWorkflows} loading={isLoading}>
              {t("settings.workflowsTab.refresh")}
            </Button>
            <Button data-testid="create-workflow" icon={<PlusOutlined />} onClick={handleCreateNew}>
              {t("settings.workflowsTab.newWorkflow")}
            </Button>
            <Button
              data-testid="save-workflow"
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSave}
              loading={isSaving}
              disabled={!isDirty}
            >
              {t("settings.workflowsTab.save")}
            </Button>
          </Space>
        }
      >
        <Text type="secondary">{t("settings.workflowsTab.description")}</Text>
        <Flex gap={token.marginLG} style={{ marginTop: token.marginLG }}>
          <div style={{ width: 320, flexShrink: 0 }}>
            <List
              loading={isLoading}
              dataSource={workflows}
              locale={{ emptyText: t("settings.workflowsTab.empty") }}
              renderItem={(workflow) => (
                <List.Item
                  style={{
                    cursor: "pointer",
                    backgroundColor:
                      selectedWorkflow?.name === workflow.name
                        ? token.colorFillSecondary
                        : "transparent",
                    borderRadius: token.borderRadius,
                    padding: token.paddingSM,
                  }}
                  onClick={() => handleSelectWorkflow(workflow)}
                  actions={[
                    <Button
                      data-testid={`delete-workflow-${workflow.name}`}
                      key="delete"
                      type="text"
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(workflow);
                      }}
                      aria-label={t("settings.workflowsTab.delete")}
                    />,
                  ]}
                >
                  <Space direction="vertical" size={0}>
                    <Text strong>/{workflow.name}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {workflow.filename}
                    </Text>
                  </Space>
                </List.Item>
              )}
            />
          </div>
          <div style={{ flex: 1 }}>
            <Space direction="vertical" size={token.marginSM} style={{ width: "100%" }}>
              <Input
                data-testid="workflow-name"
                placeholder={t("settings.workflowsTab.namePlaceholder")}
                value={editorName}
                onChange={(e) => {
                  setEditorName(e.target.value);
                  setIsDirty(true);
                }}
                disabled={Boolean(selectedWorkflow)}
                prefix={<EditOutlined />}
              />
              <TextArea
                data-testid="workflow-content"
                placeholder={t("settings.workflowsTab.contentPlaceholder")}
                value={editorContent}
                onChange={(e) => {
                  setEditorContent(e.target.value);
                  setIsDirty(true);
                }}
                autoSize={{ minRows: 12 }}
                disabled={isLoadingContent}
              />
            </Space>
          </div>
        </Flex>
      </Card>
    </div>
  );
};

export default SystemSettingsWorkflowsTab;
