import React, { lazy, Suspense, useMemo, useState } from "react";
import { Button, Flex, Select, Tooltip, theme } from "antd";
import { AppstoreOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";

import { useAppStore } from "@shared/store/appStore";

// Lazy-load the manager modal — it pulls in the workspace picker, resource
// summary, and mutation flows, none of which are needed until opened.
const ProjectManagerModal = lazy(() => import("../ProjectManagerModal"));
const LegacyMigrationModal = lazy(() => import("../LegacyMigrationModal"));

/**
 * Project switcher (#154): picks the "active" Project used as the default
 * membership for newly created sessions, and opens the Project manager.
 * Hidden entirely when the backend predates the Project API (404 on list).
 */
export const ProjectSwitcher: React.FC = () => {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const { projects, projectsAvailable, activeProjectId, setActiveProjectId } = useAppStore(
    useShallow((state) => ({
      projects: state.projects,
      projectsAvailable: state.projectsAvailable,
      activeProjectId: state.activeProjectId,
      setActiveProjectId: state.setActiveProjectId,
    })),
  );
  const [managerOpen, setManagerOpen] = useState(false);
  const [migrationOpen, setMigrationOpen] = useState(false);

  const options = useMemo(() => {
    const active = Object.values(projects)
      .filter((project) => project.status === "active")
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map((project) => ({ value: project.id, label: project.name }));
    return [{ value: "", label: t("chat.project.noProject") }, ...active];
  }, [projects, t]);

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
        value={activeProjectId ?? ""}
        options={options}
        onChange={(value) => setActiveProjectId(value === "" ? null : value)}
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
