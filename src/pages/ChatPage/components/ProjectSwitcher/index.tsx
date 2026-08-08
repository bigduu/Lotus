import React, { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { App as AntdApp, Button, Flex, Select, Tooltip, theme } from "antd";
import { AppstoreOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";

import { useAppStore } from "@shared/store/appStore";
import { getProjectAssignmentErrorMessage } from "../SessionProjectModal/projectAssignmentErrors";

// Lazy-load the manager modal — it pulls in the workspace picker, resource
// summary, and mutation flows, none of which are needed until opened.
const ProjectManagerModal = lazy(() => import("../ProjectManagerModal"));
const LegacyMigrationModal = lazy(() => import("../LegacyMigrationModal"));

/**
 * Project switcher (#154/#208): shows and mutates the selected root session's
 * first-class Project. With no selected session it controls the default
 * Project used for newly created sessions.
 * Hidden entirely when the backend predates the Project API (404 on list).
 */
export const ProjectSwitcher: React.FC = () => {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const { message } = AntdApp.useApp();
  const {
    projects,
    projectsLoading,
    projectsAvailable,
    activeProjectId,
    setActiveProjectId,
    currentSessionId,
    currentChat,
    assignSessionProject,
  } = useAppStore(
    useShallow((state) => {
      const currentSessionId = state.currentSessionId;
      return {
        projects: state.projects,
        projectsLoading: state.projectsLoading,
        projectsAvailable: state.projectsAvailable,
        activeProjectId: state.activeProjectId,
        setActiveProjectId: state.setActiveProjectId,
        currentSessionId,
        currentChat: currentSessionId
          ? (state.chats.find((chat) => chat.id === currentSessionId) ?? null)
          : null,
        assignSessionProject: state.assignSessionProject,
      };
    }),
  );
  const [managerOpen, setManagerOpen] = useState(false);
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [assigning, setAssigning] = useState(false);

  const sessionProjectId = currentChat?.config.projectId?.trim() || null;

  const options = useMemo(() => {
    const active: Array<{ value: string; label: string; disabled?: boolean }> = Object.values(
      projects,
    )
      .filter((project) => project.status === "active")
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map((project) => {
        const pathReady =
          project.project_path_status === "configured" && Boolean(project.project_path?.trim());
        return {
          value: project.id,
          label: pathReady
            ? project.name
            : `${project.name} · ${t("chat.project.pathNeedsConfiguration")}`,
          disabled: !pathReady,
        };
      });
    const current = sessionProjectId ? projects[sessionProjectId] : undefined;
    if (current && current.status !== "active") {
      active.push({
        value: current.id,
        label: `${current.name} · ${t("chat.project.archivedTag")}`,
        disabled: true,
      });
    }
    return active;
  }, [projects, sessionProjectId, t]);

  // The current root session defines the active Project context. Keep the
  // new-session default aligned so selecting another Project group does not
  // send the next session back to an unrelated stale default.
  useEffect(() => {
    if (
      currentChat?.kind !== "child" &&
      sessionProjectId &&
      projects[sessionProjectId]?.status === "active" &&
      projects[sessionProjectId]?.project_path_status === "configured" &&
      Boolean(projects[sessionProjectId]?.project_path?.trim()) &&
      activeProjectId !== sessionProjectId
    ) {
      setActiveProjectId(sessionProjectId);
    }
  }, [activeProjectId, currentChat?.kind, projects, sessionProjectId, setActiveProjectId]);

  const handleProjectChange = async (projectId: string): Promise<void> => {
    if (!currentSessionId || !currentChat) {
      setActiveProjectId(projectId);
      return;
    }
    if (currentChat.kind === "child") {
      message.info(t("chat.project.childProjectInherited"));
      return;
    }
    if (projectId === sessionProjectId) return;

    setAssigning(true);
    try {
      await assignSessionProject(currentSessionId, projectId);
      message.success(t("chat.project.assignmentSuccess"));
    } catch (error) {
      message.error(getProjectAssignmentErrorMessage(error));
    } finally {
      setAssigning(false);
    }
  };

  // null = unknown yet (first load in flight) — render the selector so the
  // user has a stable anchor; false = backend has no Project API, hide.
  if (projectsAvailable === false) {
    return null;
  }

  return (
    <Flex gap={6} align="center">
      <Select
        size="small"
        style={{ flex: 1, minWidth: 0 }}
        value={(currentChat ? sessionProjectId : activeProjectId) ?? undefined}
        options={options}
        placeholder={t("chat.project.selectForSession")}
        onChange={(value) => void handleProjectChange(value)}
        loading={projectsLoading || assigning}
        disabled={currentChat?.kind === "child"}
        aria-label={t("chat.project.selectorLabel")}
        data-testid="project-switcher"
      />
      <Tooltip title={t("chat.project.manage")} placement="top">
        <Button
          type="text"
          size="small"
          icon={<AppstoreOutlined />}
          onClick={() => setManagerOpen(true)}
          aria-label={t("chat.project.manage")}
          data-testid="open-project-manager"
          className="lotus-toolbar-icon"
          style={{ borderRadius: token.borderRadiusLG, flexShrink: 0 }}
        />
      </Tooltip>

      {managerOpen ? (
        <Suspense fallback={null}>
          <ProjectManagerModal
            open={managerOpen}
            onClose={() => setManagerOpen(false)}
            onOpenMigration={() => setMigrationOpen(true)}
          />
        </Suspense>
      ) : null}

      {migrationOpen ? (
        <Suspense fallback={null}>
          <LegacyMigrationModal open={migrationOpen} onClose={() => setMigrationOpen(false)} />
        </Suspense>
      ) : null}
    </Flex>
  );
};

export default ProjectSwitcher;
