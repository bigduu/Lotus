import React, { useEffect, useState } from "react";
import { Modal, Space, Alert, message } from "antd";
import { Typography } from "@/components/ui/typography";
import { useTranslation } from "react-i18next";
import WorkspacePicker from "../WorkspacePicker";
import { recentWorkspacesManager } from "../../services/RecentWorkspacesManager";
import { WorkspaceValidationResult } from "../../services/WorkspaceApiService";

const { Title } = Typography;

interface WorkspacePathModalProps {
  open: boolean;
  initialPath?: string;
  loading?: boolean;
  onSubmit: (workspacePath: string) => void;
  onCancel: () => void;
}

const WorkspacePathModal: React.FC<WorkspacePathModalProps> = ({
  open,
  initialPath = "",
  loading = false,
  onSubmit,
  onCancel,
}) => {
  const { t } = useTranslation();
  const [path, setPath] = useState(initialPath);
  const [validationResult, setValidationResult] = useState<WorkspaceValidationResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setPath(initialPath);
      setValidationResult(null);
    }
  }, [open, initialPath]);

  const handlePathChange = (newPath: string) => {
    setPath(newPath);
  };

  const handleValidationChange = (result: WorkspaceValidationResult | null) => {
    setValidationResult(result);
  };

  const handleSubmit = async () => {
    if (!path.trim()) {
      message.error(t("chat.workspace.errorEnterPath"));
      return;
    }

    // If path is not valid, show warning but still allow submission
    if (validationResult && !validationResult.is_valid) {
      Modal.confirm({
        title: t("chat.workspace.invalidTitle"),
        content: (
          <div>
            <p>{t("chat.workspace.issuesDetected")}</p>
            <p>{validationResult.error_message || t("chat.workspace.invalidTitle")}</p>
            <p>{t("chat.workspace.confirmSaveInvalid")}</p>
          </div>
        ),
        okText: t("common.saveAnyway"),
        cancelText: t("common.cancel"),
        onOk: () => performSubmit(),
      });
    } else {
      performSubmit();
    }
  };

  const performSubmit = async () => {
    setIsSubmitting(true);
    try {
      // Add to recent workspaces if valid
      if (validationResult?.is_valid) {
        await recentWorkspacesManager.addRecentWorkspace(path.trim(), {
          workspace_name: validationResult.workspace_name,
        });
      }

      onSubmit(path.trim());
    } catch (error) {
      console.error("Failed to save workspace path:", error);
      message.error(t("chat.workspace.errorSaveFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const isSubmitDisabled = !path.trim() || loading || isSubmitting;

  return (
    <Modal
      open={open}
      title={
        <Space>
          <Title level={4} style={{ margin: 0 }}>
            {t("chat.workspace.modalTitle")}
          </Title>
        </Space>
      }
      okText={t("common.save")}
      cancelText={t("common.cancel")}
      onOk={handleSubmit}
      onCancel={onCancel}
      okButtonProps={{
        disabled: isSubmitDisabled,
        loading: isSubmitting || loading,
      }}
      width={600}
      destroyOnClose
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Alert
          message={t("chat.workspace.descriptionTitle")}
          description={
            <div>
              <p>{t("chat.workspace.descriptionP1")}</p>
              <p>{t("chat.workspace.descriptionP2")}</p>
            </div>
          }
          type="info"
          showIcon
        />

        <WorkspacePicker
          value={path}
          onChange={handlePathChange}
          onValidationChange={handleValidationChange}
          placeholder={t("chat.workspace.placeholder")}
          disabled={isSubmitting}
          allowBrowse={true}
          showRecentWorkspaces={true}
          showSuggestions={true}
        />

        {validationResult && !validationResult.is_valid && (
          <Alert
            message={t("chat.workspace.checkTitle")}
            description={validationResult.error_message || t("chat.workspace.checkDescription")}
            type="warning"
            showIcon
          />
        )}
      </Space>
    </Modal>
  );
};

export default WorkspacePathModal;
