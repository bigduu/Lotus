import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Empty,
  Modal,
  Radio,
  Select,
  Space,
  Spin,
  Typography,
} from "antd";
import { AppstoreOutlined, PlusOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";

import type { SessionSummary } from "@services/chat/AgentService";
import type { ProjectManifest } from "@services/project";
import { useAppStore } from "@shared/store/appStore";
import { getProjectAssignmentErrorMessage } from "./projectAssignmentErrors";

const { Text } = Typography;
const ProjectManagerModal = lazy(() => import("../ProjectManagerModal"));

export type SessionProjectModalProps = {
  open: boolean;
  sessionId: string | null;
  currentProjectId?: string | null;
  currentWorkspacePath?: string | null;
  isChildSession?: boolean;
  onCancel: () => void;
  onAssigned?: (session: SessionSummary) => void;
};

/**
 * Assign one root session to a first-class Project and one of its authoritative
 * workspaces through Bamboo's metadata CAS API.
 */
export const SessionProjectModal: React.FC<SessionProjectModalProps> = ({
  open,
  sessionId,
  currentProjectId = null,
  currentWorkspacePath = null,
  isChildSession = false,
  onCancel,
  onAssigned,
}) => {
  const { t } = useTranslation();
  const { message } = AntdApp.useApp();
  const {
    projects,
    projectsLoading,
    projectsError,
    projectsLoadedAt,
    projectsAvailable,
    activeProjectId,
    loadProjects,
    ensureProject,
    assignSessionProject,
  } = useAppStore(
    useShallow((state) => ({
      projects: state.projects,
      projectsLoading: state.projectsLoading,
      projectsError: state.projectsError,
      projectsLoadedAt: state.projectsLoadedAt,
      projectsAvailable: state.projectsAvailable,
      activeProjectId: state.activeProjectId,
      loadProjects: state.loadProjects,
      ensureProject: state.ensureProject,
      assignSessionProject: state.assignSessionProject,
    })),
  );

  const eligibleProjects = useMemo(
    () =>
      Object.values(projects)
        .filter(
          (project) =>
            project.status === "active" &&
            project.project_path_status === "configured" &&
            Boolean(project.project_path?.trim()),
        )
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [projects],
  );
  const eligibleProjectIds = useMemo(
    () => new Set(eligibleProjects.map((project) => project.id)),
    [eligibleProjects],
  );

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedWorkspacePath, setSelectedWorkspacePath] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [projectDetailsLoading, setProjectDetailsLoading] = useState(false);
  const [projectDetailsReadyId, setProjectDetailsReadyId] = useState<string | null>(null);
  const [projectDetailsError, setProjectDetailsError] = useState<string | null>(null);
  const [projectManagerOpen, setProjectManagerOpen] = useState(false);
  const [projectManagerInitialView, setProjectManagerInitialView] = useState<"manage" | "create">(
    "manage",
  );
  const initializedContextRef = useRef<string | null>(null);
  const detailLoadIdRef = useRef(0);
  const projectListLoadAttemptedRef = useRef(false);

  const contextKey = `${sessionId ?? ""}:${currentProjectId ?? ""}:${currentWorkspacePath ?? ""}`;

  useEffect(() => {
    if (!open) {
      initializedContextRef.current = null;
      projectListLoadAttemptedRef.current = false;
      setProjectManagerOpen(false);
      setProjectManagerInitialView("manage");
      return;
    }
    setSubmitError(null);
    setLoadError(null);
    if (!projectListLoadAttemptedRef.current) {
      projectListLoadAttemptedRef.current = true;
      void loadProjects().catch((error) => {
        setLoadError(error instanceof Error ? error.message : t("chat.project.loadFailed"));
      });
    }
  }, [loadProjects, open, t]);

  useEffect(() => {
    if (!open || initializedContextRef.current === contextKey) return;
    if (projectsLoadedAt === null && projectsAvailable !== false) return;

    const preferredProjectId =
      (currentProjectId && eligibleProjectIds.has(currentProjectId) && currentProjectId) ||
      (activeProjectId && eligibleProjectIds.has(activeProjectId) && activeProjectId) ||
      eligibleProjects[0]?.id ||
      null;
    const preferredProject = preferredProjectId ? projects[preferredProjectId] : null;
    const currentPath =
      preferredProjectId === currentProjectId ? currentWorkspacePath?.trim() || "" : "";

    initializedContextRef.current = contextKey;
    setSelectedProjectId(preferredProjectId);
    setSelectedWorkspacePath(currentPath || preferredProject?.project_path?.trim() || "");
    setProjectDetailsError(null);
  }, [
    activeProjectId,
    contextKey,
    currentProjectId,
    currentWorkspacePath,
    eligibleProjectIds,
    eligibleProjects,
    open,
    projects,
    projectsAvailable,
    projectsLoadedAt,
  ]);

  useEffect(() => {
    const loadId = detailLoadIdRef.current + 1;
    detailLoadIdRef.current = loadId;
    if (!open || projectManagerOpen || !selectedProjectId) {
      setProjectDetailsLoading(false);
      setProjectDetailsReadyId(null);
      setProjectDetailsError(null);
      return;
    }

    setProjectDetailsLoading(true);
    setProjectDetailsReadyId(null);
    setProjectDetailsError(null);
    ensureProject(selectedProjectId, { force: true })
      .then(() => {
        if (detailLoadIdRef.current === loadId) {
          setProjectDetailsReadyId(selectedProjectId);
        }
      })
      .catch(() => {
        if (detailLoadIdRef.current === loadId) {
          setProjectDetailsError(t("chat.project.assignProjectLoadFailed"));
        }
      })
      .finally(() => {
        if (detailLoadIdRef.current === loadId) {
          setProjectDetailsLoading(false);
        }
      });
  }, [ensureProject, open, projectManagerOpen, selectedProjectId, t]);

  const selectedProject = selectedProjectId ? projects[selectedProjectId] : null;
  const workspaceOptions = useMemo(() => {
    if (!selectedProject) return [];
    const seen = new Set<string>();
    const options: Array<{ value: string; label: string }> = [];
    const add = (path: string | null | undefined, label: string) => {
      const normalized = path?.trim();
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      options.push({ value: normalized, label });
    };

    add(selectedProject.project_path, t("chat.workspace.primaryProjectPath"));
    for (const binding of selectedProject.workspace_bindings) {
      add(binding.path, binding.label?.trim() || t("chat.workspace.additionalProjectWorkspace"));
    }
    return options;
  }, [selectedProject, t]);

  useEffect(() => {
    if (!open || workspaceOptions.length === 0) return;
    if (projectDetailsReadyId !== selectedProjectId) return;
    if (workspaceOptions.some((option) => option.value === selectedWorkspacePath)) return;
    setSelectedWorkspacePath(workspaceOptions[0].value);
  }, [open, projectDetailsReadyId, selectedProjectId, selectedWorkspacePath, workspaceOptions]);

  const handleProjectChange = (projectId: string) => {
    initializedContextRef.current = contextKey;
    setSelectedProjectId(projectId);
    setSelectedWorkspacePath(projects[projectId]?.project_path?.trim() || "");
    setProjectDetailsReadyId(null);
    setProjectDetailsError(null);
    setSubmitError(null);
  };

  const openProjectManager = (initialView: "manage" | "create") => {
    setProjectManagerInitialView(initialView);
    setProjectManagerOpen(true);
  };

  const handleProjectCreated = (project: ProjectManifest) => {
    initializedContextRef.current = contextKey;
    setSelectedProjectId(project.id);
    setSelectedWorkspacePath(project.project_path?.trim() || "");
    setProjectDetailsReadyId(null);
    setProjectDetailsError(null);
    setSubmitError(null);
  };

  const isBusy = loading || projectsLoading || projectDetailsLoading;
  const isUnchanged =
    selectedProjectId === currentProjectId &&
    selectedWorkspacePath === (currentWorkspacePath?.trim() || "");
  const canSubmit = Boolean(
    sessionId &&
      !isChildSession &&
      selectedProjectId &&
      selectedWorkspacePath &&
      workspaceOptions.some((option) => option.value === selectedWorkspacePath) &&
      projectDetailsReadyId === selectedProjectId &&
      !isBusy &&
      !isUnchanged,
  );

  const handleSubmit = async (): Promise<void> => {
    if (!sessionId || !selectedProjectId || !selectedWorkspacePath || isChildSession) return;
    if (isUnchanged) {
      onCancel();
      return;
    }
    setLoading(true);
    setSubmitError(null);
    try {
      const session = await assignSessionProject(
        sessionId,
        selectedProjectId,
        selectedWorkspacePath,
      );
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
    <>
      <Modal
        open={open && !projectManagerOpen}
        title={t("chat.project.sessionModalTitle")}
        okText={t("chat.project.assign")}
        cancelText={t("common.cancel")}
        onOk={() => void handleSubmit()}
        onCancel={onCancel}
        okButtonProps={{ disabled: !canSubmit, loading: isBusy }}
        cancelButtonProps={{ disabled: isBusy }}
        maskClosable={!isBusy}
        keyboard={!isBusy}
        destroyOnClose
        width={600}
      >
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Text type="secondary">{t("chat.project.sessionModalDescription")}</Text>

          {isChildSession ? (
            <Alert type="info" showIcon message={t("chat.project.childProjectInherited")} />
          ) : null}

          {!isChildSession && projectsAvailable !== false ? (
            <Space wrap>
              <Button
                type={eligibleProjects.length === 0 ? "primary" : "default"}
                icon={<PlusOutlined />}
                onClick={() => openProjectManager("create")}
                data-testid="session-project-create"
              >
                {t("chat.project.createAction")}
              </Button>
              <Button
                icon={<AppstoreOutlined />}
                onClick={() => openProjectManager("manage")}
                data-testid="session-project-manage"
              >
                {t("chat.project.manageWorkspaces")}
              </Button>
            </Space>
          ) : null}

          {projectsAvailable === false ? (
            <Alert type="error" showIcon message={t("chat.project.assignmentUnavailable")} />
          ) : eligibleProjects.length === 0 && !projectsLoading ? (
            <Empty description={t("chat.project.assignNoProjects")} />
          ) : (
            <>
              <Space direction="vertical" size="small" style={{ width: "100%" }}>
                <Text strong>{t("chat.project.selectorLabel")}</Text>
                <Select
                  value={selectedProjectId ?? undefined}
                  options={eligibleProjects.map((project) => ({
                    value: project.id,
                    label: project.name,
                  }))}
                  placeholder={t("chat.project.selectForSession")}
                  onChange={handleProjectChange}
                  loading={projectsLoading}
                  disabled={isChildSession}
                  style={{ width: "100%" }}
                  data-testid="session-project-select"
                />
              </Space>

              {selectedProjectId ? (
                <Space direction="vertical" size="small" style={{ width: "100%" }}>
                  <Space>
                    <Text strong>{t("chat.workspace.projectWorkspaces")}</Text>
                    {projectDetailsLoading ? <Spin size="small" /> : null}
                  </Space>
                  <Radio.Group
                    value={selectedWorkspacePath}
                    onChange={(event) => {
                      setSelectedWorkspacePath(event.target.value);
                      setSubmitError(null);
                    }}
                    disabled={isChildSession || isBusy}
                    style={{ width: "100%" }}
                  >
                    <Space direction="vertical" size="small" style={{ width: "100%" }}>
                      {workspaceOptions.map((option, index) => (
                        <Radio
                          key={option.value}
                          value={option.value}
                          data-testid={`session-project-workspace-${index}`}
                        >
                          <Space direction="vertical" size={0}>
                            <Text strong={index === 0}>{option.label}</Text>
                            <Text code>{option.value}</Text>
                          </Space>
                        </Radio>
                      ))}
                    </Space>
                  </Radio.Group>
                </Space>
              ) : null}
            </>
          )}

          {loadError || projectsError ? (
            <Alert type="error" showIcon message={loadError || projectsError} />
          ) : null}
          {projectDetailsError ? (
            <Alert type="error" showIcon message={projectDetailsError} />
          ) : null}
          {submitError ? <Alert type="error" showIcon message={submitError} /> : null}
        </Space>
      </Modal>

      {projectManagerOpen ? (
        <Suspense fallback={null}>
          <ProjectManagerModal
            open={projectManagerOpen}
            initialView={projectManagerInitialView}
            onClose={() => {
              setProjectManagerOpen(false);
              setProjectManagerInitialView("manage");
            }}
            onProjectCreated={handleProjectCreated}
          />
        </Suspense>
      ) : null}
    </>
  );
};

export default SessionProjectModal;
