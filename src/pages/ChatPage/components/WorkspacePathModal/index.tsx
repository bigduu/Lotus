import React, { useEffect, useMemo, useRef, useState } from "react";
import { App as AntApp, Modal, Typography, Space, Alert, Radio, Spin } from "antd";
import { useTranslation } from "react-i18next";
import WorkspacePicker from "../WorkspacePicker";
import { recentWorkspacesManager } from "../../services/RecentWorkspacesManager";
import type { Workspace } from "@services/workspace";
import { useAppStore } from "@shared/store/appStore";

const { Text, Title } = Typography;
const OTHER_FOLDER = "__other_folder__";

interface WorkspacePathModalProps {
  open: boolean;
  initialPath?: string;
  projectId?: string | null;
  loading?: boolean;
  submitError?: string | null;
  onSubmit: (workspacePath: string) => boolean | Promise<boolean>;
  onCancel: () => void;
}

const WorkspacePathModal: React.FC<WorkspacePathModalProps> = ({
  open,
  initialPath = "",
  projectId = null,
  loading = false,
  submitError = null,
  onSubmit,
  onCancel,
}) => {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [path, setPath] = useState(initialPath);
  const [validationResult, setValidationResult] = useState<Workspace | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selection, setSelection] = useState(OTHER_FOLDER);
  const [otherPath, setOtherPath] = useState(initialPath);
  const [projectPathsLoading, setProjectPathsLoading] = useState(false);
  const [projectPathsError, setProjectPathsError] = useState<string | null>(null);
  const didChoosePathRef = useRef(false);
  const projectLoadIdRef = useRef(0);
  const project = useAppStore((state) => (projectId ? state.projects[projectId] : undefined));
  const ensureProject = useAppStore((state) => state.ensureProject);

  const projectPaths = useMemo(() => {
    if (!project) return [];
    const seen = new Set<string>();
    const paths: Array<{ path: string; label: string; primary: boolean }> = [];
    const add = (candidate: string | null | undefined, label: string, primary: boolean) => {
      const normalized = candidate?.trim();
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      paths.push({ path: normalized, label, primary });
    };

    add(project.project_path, t("chat.workspace.primaryProjectPath"), true);
    for (const binding of project.workspace_bindings) {
      add(
        binding.path,
        binding.label?.trim() || t("chat.workspace.additionalProjectWorkspace"),
        false,
      );
    }
    return paths;
  }, [project, t]);

  useEffect(() => {
    if (open) {
      const normalized = initialPath.trim();
      setPath(normalized);
      setOtherPath(normalized);
      setSelection(OTHER_FOLDER);
      setValidationResult(null);
      didChoosePathRef.current = false;
    }
  }, [open, initialPath, projectId]);

  // Refresh the full manifest whenever the picker opens. Cached paths may be
  // rendered while loading, but saving stays disabled until this authoritative
  // detail request settles.
  useEffect(() => {
    const loadId = projectLoadIdRef.current + 1;
    projectLoadIdRef.current = loadId;
    if (!open || !projectId) {
      setProjectPathsLoading(false);
      setProjectPathsError(null);
      return;
    }

    setProjectPathsLoading(true);
    setProjectPathsError(null);
    ensureProject(projectId, { force: true })
      .catch(() => {
        if (projectLoadIdRef.current === loadId) {
          setProjectPathsError(t("chat.workspace.projectPathsLoadFailed"));
        }
      })
      .finally(() => {
        if (projectLoadIdRef.current === loadId) {
          setProjectPathsLoading(false);
        }
      });
  }, [ensureProject, open, projectId, t]);

  // A refreshed manifest can arrive after the modal opens. Adopt the matching
  // bound option only until the user makes an explicit selection/edit.
  useEffect(() => {
    if (!open || didChoosePathRef.current) return;
    const normalized = initialPath.trim();
    const match = projectPaths.find((option) => option.path === normalized);
    setSelection(match?.path ?? OTHER_FOLDER);
  }, [initialPath, open, projectPaths]);

  const handlePathChange = (newPath: string) => {
    didChoosePathRef.current = true;
    setSelection(OTHER_FOLDER);
    setOtherPath(newPath);
    setPath(newPath);
  };

  const handleValidationChange = (result: Workspace | null) => {
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
      const confirmed = await onSubmit(path.trim());
      if (!confirmed) return;

      // A rejected Project/unbound path must never enter recents. This
      // best-effort convenience write happens only after Bamboo confirms.
      if (validationResult?.is_valid) {
        try {
          await recentWorkspacesManager.addRecentWorkspace(path.trim(), {
            workspace_name: validationResult.workspace_name,
          });
        } catch (error) {
          console.warn("Failed to record recent workspace:", error);
        }
      }
    } catch (error) {
      console.error("Failed to save workspace path:", error);
      message.error(t("chat.workspace.errorSaveFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSelectionChange = (value: string) => {
    didChoosePathRef.current = true;
    setValidationResult(null);
    setSelection(value);
    if (value === OTHER_FOLDER) {
      setPath(otherPath);
      return;
    }
    setPath(value);
  };

  const isBusy = loading || isSubmitting || projectPathsLoading;
  const isSubmitDisabled = !path.trim() || isBusy;

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
      maskClosable={!isBusy}
      keyboard={!isBusy}
      okButtonProps={{
        disabled: isSubmitDisabled,
        loading: isBusy,
      }}
      cancelButtonProps={{ disabled: isBusy }}
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

        {projectId && (
          <Space direction="vertical" size="small" style={{ width: "100%" }}>
            <Space>
              <Text strong>{t("chat.workspace.projectWorkspaces")}</Text>
              {projectPathsLoading && (
                <>
                  <Spin size="small" />
                  <Text type="secondary">{t("chat.workspace.projectPathsLoading")}</Text>
                </>
              )}
            </Space>
            <Text type="secondary">{t("chat.workspace.projectWorkspacesDescription")}</Text>
            {projectPathsError && <Alert type="warning" message={projectPathsError} showIcon />}
            <Radio.Group
              value={selection}
              onChange={(event) => handleSelectionChange(event.target.value)}
              disabled={isBusy}
              style={{ width: "100%" }}
            >
              <Space direction="vertical" size="small" style={{ width: "100%" }}>
                {projectPaths.map((option, index) => (
                  <Radio
                    key={option.path}
                    value={option.path}
                    data-testid={`project-workspace-option-${index}`}
                  >
                    <Space direction="vertical" size={0}>
                      <Text strong={option.primary}>{option.label}</Text>
                      <Text code>{option.path}</Text>
                    </Space>
                  </Radio>
                ))}
                <Radio value={OTHER_FOLDER} data-testid="project-workspace-other">
                  {t("chat.workspace.otherFolder")}
                </Radio>
              </Space>
            </Radio.Group>
          </Space>
        )}

        {(!projectId || selection === OTHER_FOLDER) && (
          <Space direction="vertical" size="small" style={{ width: "100%" }}>
            {projectId && (
              <Alert
                type="warning"
                message={t("chat.workspace.otherFolder")}
                description={t("chat.workspace.otherFolderHint")}
                showIcon
              />
            )}
            <WorkspacePicker
              value={path}
              onChange={handlePathChange}
              onValidationChange={handleValidationChange}
              placeholder={t("chat.workspace.placeholder")}
              disabled={isBusy}
              allowBrowse={true}
              showRecentWorkspaces={!projectId}
              showSuggestions={!projectId}
            />
          </Space>
        )}

        {validationResult && !validationResult.is_valid && (
          <Alert
            message={t("chat.workspace.checkTitle")}
            description={validationResult.error_message || t("chat.workspace.checkDescription")}
            type="warning"
            showIcon
          />
        )}

        {submitError && <Alert type="error" message={submitError} showIcon />}
      </Space>
    </Modal>
  );
};

export default WorkspacePathModal;
