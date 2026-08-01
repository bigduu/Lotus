import React, { useEffect, useMemo, useState } from "react";
import { Alert, App as AntdApp, Modal, Select, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";

import type { SessionSummary } from "@services/chat/AgentService";
import { useAppStore } from "@shared/store/appStore";
import { getProjectAssignmentErrorMessage } from "./projectAssignmentErrors";

const { Text } = Typography;

export type SessionProjectModalProps = {
  open: boolean;
  sessionId: string | null;
  currentProjectId?: string | null;
  isChildSession?: boolean;
  onCancel: () => void;
  onAssigned?: (session: SessionSummary) => void;
};

/** Assign one root session to a first-class Project through Bamboo's CAS API. */
export const SessionProjectModal: React.FC<SessionProjectModalProps> = ({
  open,
  sessionId,
  currentProjectId = null,
  isChildSession = false,
  onCancel,
  onAssigned,
}) => {
  const { t } = useTranslation();
  const { message } = AntdApp.useApp();
  const { projects, projectsLoading, activeProjectId, loadProjects, assignSessionProject } =
    useAppStore(
      useShallow((state) => ({
        projects: state.projects,
        projectsLoading: state.projectsLoading,
        activeProjectId: state.activeProjectId,
        loadProjects: state.loadProjects,
        assignSessionProject: state.assignSessionProject,
      })),
    );
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const selectableProjects = useMemo(
    () =>
      Object.values(projects)
        .filter((project) => project.status === "active")
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [projects],
  );
  const options = useMemo(
    () =>
      selectableProjects.map((project) => {
        const pathReady =
          project.project_path_status === "configured" && Boolean(project.project_path?.trim());
        return {
          value: project.id,
          disabled: !pathReady,
          label: pathReady
            ? project.name
            : `${project.name} · ${t("chat.project.pathNeedsConfiguration")}`,
        };
      }),
    [selectableProjects, t],
  );

  useEffect(() => {
    if (!open) return;
    setSubmitError(null);
    setLoadError(null);
    void loadProjects().catch((error) => {
      setLoadError(error instanceof Error ? error.message : t("chat.project.loadFailed"));
    });
  }, [loadProjects, open, t]);

  useEffect(() => {
    if (!open) return;
    const isReady = (id: string | null | undefined): id is string => {
      if (!id) return false;
      const project = projects[id];
      return Boolean(
        project?.status === "active" &&
          project.project_path_status === "configured" &&
          project.project_path?.trim(),
      );
    };
    if (isReady(currentProjectId)) {
      setSelectedProjectId(currentProjectId);
    } else if (isReady(activeProjectId)) {
      setSelectedProjectId(activeProjectId);
    } else {
      const ready = selectableProjects.filter(
        (project) =>
          project.project_path_status === "configured" && Boolean(project.project_path?.trim()),
      );
      setSelectedProjectId(ready.length === 1 ? ready[0].id : null);
    }
  }, [activeProjectId, currentProjectId, open, projects, selectableProjects]);

  const handleSubmit = async (): Promise<void> => {
    if (!sessionId || !selectedProjectId || isChildSession) return;
    if (selectedProjectId === currentProjectId) {
      onCancel();
      return;
    }
    setLoading(true);
    setSubmitError(null);
    try {
      const session = await assignSessionProject(sessionId, selectedProjectId);
      message.success(t("chat.project.assignmentSuccess"));
      onAssigned?.(session);
      onCancel();
    } catch (error) {
      const text = getProjectAssignmentErrorMessage(error);
      setSubmitError(text);
      message.error(text);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t("chat.project.sessionModalTitle")}
      okText={t("chat.project.assign")}
      cancelText={t("common.cancel")}
      onOk={() => void handleSubmit()}
      onCancel={onCancel}
      confirmLoading={loading}
      okButtonProps={{
        disabled:
          isChildSession ||
          !sessionId ||
          !selectedProjectId ||
          selectedProjectId === currentProjectId,
      }}
      destroyOnClose
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Text type="secondary">{t("chat.project.sessionModalDescription")}</Text>
        {isChildSession ? (
          <Alert type="info" showIcon message={t("chat.project.childProjectInherited")} />
        ) : null}
        {loadError ? <Alert type="error" showIcon message={loadError} /> : null}
        {submitError ? <Alert type="error" showIcon message={submitError} /> : null}
        <Select
          value={selectedProjectId ?? undefined}
          options={options}
          placeholder={t("chat.project.selectForSession")}
          onChange={(value) => setSelectedProjectId(value)}
          loading={projectsLoading}
          disabled={isChildSession}
          style={{ width: "100%" }}
          data-testid="session-project-select"
        />
      </Space>
    </Modal>
  );
};

export default SessionProjectModal;
