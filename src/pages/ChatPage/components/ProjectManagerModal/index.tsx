import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  App as AntdApp,
  Button,
  Divider,
  Empty,
  Flex,
  Input,
  List,
  Modal,
  Popconfirm,
  Tag,
  Typography,
  theme,
} from "antd";
import {
  DeleteOutlined,
  DownOutlined,
  FolderOutlined,
  InboxOutlined,
  PlusOutlined,
  RightOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";

import { useAppStore } from "@shared/store/appStore";
import { isApiError } from "@services/api";
import type { ProjectManifest } from "@services/project";

const { Text } = Typography;

type ProjectManagerModalProps = {
  open: boolean;
  onClose: () => void;
  /** Opens the legacy migration wizard (rendered as a sibling modal). */
  onOpenMigration: () => void;
};

const structuredErrorCode = (error: unknown): string | null => {
  if (!isApiError(error) || !error.body) return null;
  try {
    const parsed = JSON.parse(error.body) as { error?: { code?: string } };
    return parsed.error?.code?.trim() || null;
  } catch {
    return null;
  }
};

/**
 * Project manager (#154): create / rename / archive Projects and manage
 * their authoritative Project path, additional workspace bindings, and
 * read-only shared-resource summary.
 *
 * Deliberately out of scope until the backend lands:
 * - session counts in the list (Bamboo-agent#727).
 */
const ProjectManagerModal: React.FC<ProjectManagerModalProps> = ({
  open,
  onClose,
  onOpenMigration,
}) => {
  const { t } = useTranslation();
  const { message } = AntdApp.useApp();
  const { token } = theme.useToken();
  const {
    projects,
    activeProjectId,
    createProject,
    updateProject,
    archiveProject,
    unarchiveProject,
    bindWorkspace,
    unbindWorkspace,
    ensureProject,
    loadProjectResources,
    projectResources,
    projectResourcesError,
  } = useAppStore(
    useShallow((state) => ({
      projects: state.projects,
      activeProjectId: state.activeProjectId,
      createProject: state.createProject,
      updateProject: state.updateProject,
      archiveProject: state.archiveProject,
      unarchiveProject: state.unarchiveProject,
      bindWorkspace: state.bindWorkspace,
      unbindWorkspace: state.unbindWorkspace,
      ensureProject: state.ensureProject,
      loadProjectResources: state.loadProjectResources,
      projectResources: state.projectResources,
      projectResourcesError: state.projectResourcesError,
    })),
  );

  const { activeProjects, archivedProjects } = useMemo(
    () => ({
      activeProjects: Object.values(projects)
        .filter((project) => project.status === "active")
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
      archivedProjects: Object.values(projects)
        .filter((project) => project.status === "archived")
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    }),
    [projects],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const selectProject = useCallback((projectId: string | null) => {
    selectedIdRef.current = projectId;
    setSelectedId(projectId);
  }, []);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [archivedExpanded, setArchivedExpanded] = useState(false);

  // Unassigned root sessions — the entry point to the legacy migration
  // wizard (#156). Children inherit their root's project on the backend.
  const unassignedRootCount = useAppStore(
    (state) => state.chats.filter((chat) => chat.kind !== "child" && !chat.config.projectId).length,
  );

  // Create form
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newProjectPath, setNewProjectPath] = useState("");

  // Detail form
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editProjectPath, setEditProjectPath] = useState("");
  const [bindingPath, setBindingPath] = useState("");

  const selected: ProjectManifest | null = selectedId ? (projects[selectedId] ?? null) : null;
  const resources = selectedId ? projectResources[selectedId] : undefined;
  const resourcesError = selectedId ? projectResourcesError[selectedId] : undefined;

  // Pick a sensible selection when the modal opens or the list changes.
  useEffect(() => {
    if (!open) return;
    if (selectedId && projects[selectedId]) return;
    const fallback = activeProjectId && projects[activeProjectId] ? activeProjectId : null;
    const fallbackId = fallback ?? activeProjects[0]?.id ?? archivedProjects[0]?.id ?? null;
    selectProject(fallbackId);
    if (fallbackId && projects[fallbackId]?.status === "archived") {
      setArchivedExpanded(true);
    }
  }, [
    open,
    projects,
    selectedId,
    activeProjectId,
    activeProjects,
    archivedProjects,
    selectProject,
  ]);

  // Load detail + resources for the selected project. Non-forced
  // ensureProject: the list endpoint already returns full manifests, so a
  // fetch only happens for summary-only records.
  useEffect(() => {
    if (!open || !selectedId) return;
    ensureProject(selectedId).catch(() => {});
    loadProjectResources(selectedId).catch(() => {});
  }, [open, selectedId, ensureProject, loadProjectResources]);

  // Reset the detail form ONLY when the selection changes — never on
  // revision bumps (a background SSE update or an unrelated bind/unbind
  // must not silently discard unsaved name/description edits).
  useEffect(() => {
    setEditName(selected?.name ?? "");
    setEditDescription(selected?.description ?? "");
    setEditProjectPath(selected?.project_path ?? "");
    setBindingPath("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  /** Shared mutation-error handling: 412 → reload + resync the form; 409 →
   * show the server's own structured message (retrying cannot help). */
  const handleMutationError = useCallback(
    (error: unknown, projectId: string, fallbackKey: string) => {
      if (isApiError(error) && error.status === 412) {
        message.error(t("chat.project.conflict"));
        ensureProject(projectId, { force: true })
          .then(() => {
            const fresh = useAppStore.getState().projects[projectId];
            // The canonical manifest always belongs in the store, but an old
            // mutation must never overwrite the form for a Project selected
            // while its conflict refetch was in flight.
            if (fresh && selectedIdRef.current === projectId) {
              setEditName(fresh.name);
              setEditDescription(fresh.description ?? "");
              setEditProjectPath(fresh.project_path ?? "");
            }
          })
          .catch(() => {});
        return;
      }
      if (isApiError(error) && error.status === 409) {
        // e.g. `project_workspace_conflict` (path owned by another Project)
        // or `project_archived` — retrying without changes cannot succeed,
        // so surface the server's reason instead of a revision hint.
        message.error(error.message || t(fallbackKey));
        return;
      }
      message.error(error instanceof Error ? error.message : t(fallbackKey));
    },
    [ensureProject, message, t],
  );

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      message.error(t("chat.project.nameRequired"));
      return;
    }
    const projectPath = newProjectPath.trim();
    if (!projectPath) {
      message.error(t("chat.project.pathRequired"));
      return;
    }
    setBusy(true);
    try {
      const manifest = await createProject({
        name,
        description: newDescription.trim() || null,
        project_path: projectPath,
      });
      setCreating(false);
      setNewName("");
      setNewDescription("");
      setNewProjectPath("");
      selectProject(manifest.id);
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("chat.project.createFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveDetail = async () => {
    if (!selected) return;
    const name = editName.trim();
    if (!name) {
      message.error(t("chat.project.nameRequired"));
      return;
    }
    const projectPath = editProjectPath.trim();
    if (!projectPath) {
      message.error(t("chat.project.pathRequired"));
      return;
    }
    setBusy(true);
    try {
      await updateProject(selected.id, selected.revision, {
        name,
        description: editDescription.trim() || null,
        ...(projectPath !== selected.project_path ? { project_path: projectPath } : {}),
      });
    } catch (error) {
      handleMutationError(error, selected.id, "chat.project.saveFailed");
    } finally {
      setBusy(false);
    }
  };

  const handleArchive = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await archiveProject(selected.id, selected.revision);
      message.success(t("chat.project.archiveSuccess"));
    } catch (error) {
      handleMutationError(error, selected.id, "chat.project.archiveFailed");
    } finally {
      setBusy(false);
    }
  };

  const handleUnarchive = async () => {
    if (!selected) return;
    const projectId = selected.id;
    setBusy(true);
    try {
      await unarchiveProject(projectId, selected.revision);
      message.success(t("chat.project.restoreSuccess"));
    } catch (error) {
      // A 409 `project_not_archived` means another client already restored
      // the Project. Reconcile the authoritative manifest so the local
      // archived section cannot remain stale after surfacing the conflict.
      if (
        isApiError(error) &&
        error.status === 409 &&
        structuredErrorCode(error) === "project_not_archived"
      ) {
        ensureProject(projectId, { force: true }).catch(() => {});
      }
      handleMutationError(error, projectId, "chat.project.restoreFailed");
    } finally {
      setBusy(false);
    }
  };

  const handleBind = async () => {
    if (!selected || !bindingPath.trim()) return;
    setBusy(true);
    try {
      await bindWorkspace(selected.id, selected.revision, {
        path: bindingPath.trim(),
        label: null,
        git_common_dir: null,
      });
      setBindingPath("");
      message.success(t("chat.project.workspaceAdded"));
    } catch (error) {
      handleMutationError(error, selected.id, "chat.project.workspaceFailed");
    } finally {
      setBusy(false);
    }
  };

  const handleUnbind = async (path: string) => {
    if (!selected) return;
    setBusy(true);
    try {
      await unbindWorkspace(selected.id, selected.revision, path);
      message.success(t("chat.project.workspaceRemoved"));
    } catch (error) {
      handleMutationError(error, selected.id, "chat.project.workspaceFailed");
    } finally {
      setBusy(false);
    }
  };

  const renderProjectListItem = (project: ProjectManifest) => (
    <List.Item
      onClick={() => {
        setCreating(false);
        selectProject(project.id);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setCreating(false);
          selectProject(project.id);
        }
      }}
      style={{
        cursor: "pointer",
        padding: "6px 8px",
        borderRadius: token.borderRadiusSM,
        background: project.id === selectedId && !creating ? token.colorFillSecondary : undefined,
      }}
      data-testid={`project-list-item-${project.id}`}
    >
      <Flex align="center" gap={6} style={{ minWidth: 0 }}>
        <Text ellipsis style={{ flex: 1 }}>
          {project.name}
        </Text>
        {project.status === "archived" ? (
          <Tag style={{ marginInlineEnd: 0 }}>{t("chat.project.archivedTag", "Archived")}</Tag>
        ) : null}
      </Flex>
    </List.Item>
  );

  return (
    <Modal
      open={open}
      title={t("chat.project.managerTitle", "Projects")}
      footer={null}
      onCancel={onClose}
      width={760}
      destroyOnClose
    >
      <Flex gap={16} style={{ minHeight: 380 }}>
        {/* Left: project list */}
        <Flex vertical style={{ width: 220, flexShrink: 0 }}>
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() => setCreating(true)}
            style={{ marginBottom: 8 }}
            data-testid="project-create-open"
          >
            {t("chat.project.newProject", "New project")}
          </Button>
          {unassignedRootCount > 0 ? (
            <Button
              size="small"
              onClick={onOpenMigration}
              style={{ marginBottom: 8 }}
              data-testid="open-legacy-migration"
            >
              {t("chat.migration.entry")} (
              {t("chat.migration.entryCount", { count: unassignedRootCount })})
            </Button>
          ) : null}
          {activeProjects.length > 0 ? (
            <List size="small" dataSource={activeProjects} renderItem={renderProjectListItem} />
          ) : archivedProjects.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : null}
          {archivedProjects.length > 0 ? (
            <div style={{ marginTop: activeProjects.length > 0 ? 8 : 0 }}>
              <Button
                type="text"
                size="small"
                block
                icon={archivedExpanded ? <DownOutlined /> : <RightOutlined />}
                onClick={() => setArchivedExpanded((expanded) => !expanded)}
                aria-expanded={archivedExpanded}
                data-testid="project-archived-toggle"
                style={{ justifyContent: "flex-start", color: token.colorTextSecondary }}
              >
                {t("chat.project.archivedProjects", "Archived projects")} ({archivedProjects.length}
                )
              </Button>
              {archivedExpanded ? (
                <List
                  size="small"
                  dataSource={archivedProjects}
                  renderItem={renderProjectListItem}
                  data-testid="project-archived-list"
                />
              ) : null}
            </div>
          ) : null}
        </Flex>

        <Divider type="vertical" style={{ height: "auto" }} />

        {/* Right: create form or detail */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {creating ? (
            <Flex vertical gap={12}>
              <Text strong>{t("chat.project.newProject", "New project")}</Text>
              <div>
                <Text type="secondary">{t("chat.project.nameLabel", "Name")}</Text>
                <Input
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder={t("chat.project.namePlaceholder")}
                  data-testid="project-create-name"
                />
              </div>
              <div>
                <Text type="secondary">{t("chat.project.descriptionLabel", "Description")}</Text>
                <Input.TextArea
                  value={newDescription}
                  onChange={(event) => setNewDescription(event.target.value)}
                  placeholder={t("chat.project.descriptionPlaceholder")}
                  rows={2}
                />
              </div>
              <div>
                <Text type="secondary">{t("chat.project.pathLabel", "Project folder")}</Text>
                <Input
                  value={newProjectPath}
                  onChange={(event) => setNewProjectPath(event.target.value)}
                  placeholder={t("chat.workspace.placeholder")}
                  prefix={<FolderOutlined />}
                  data-testid="project-create-path"
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t("chat.project.pathDescription")}
                </Text>
              </div>
              <Flex gap={8}>
                <Button
                  type="primary"
                  loading={busy}
                  onClick={handleCreate}
                  data-testid="project-create-submit"
                >
                  {t("chat.project.create", "Create")}
                </Button>
                <Button onClick={() => setCreating(false)}>{t("common.cancel")}</Button>
              </Flex>
            </Flex>
          ) : selected ? (
            <Flex vertical gap={12}>
              <Flex align="center" gap={8}>
                <Text strong style={{ fontSize: 15 }}>
                  {selected.name}
                </Text>
                {selected.status === "archived" ? (
                  <Tag>{t("chat.project.archivedTag", "Archived")}</Tag>
                ) : null}
              </Flex>

              <div>
                <Text type="secondary">{t("chat.project.nameLabel", "Name")}</Text>
                <Input
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  disabled={selected.status === "archived"}
                  data-testid="project-detail-name"
                />
              </div>
              <div>
                <Text type="secondary">{t("chat.project.descriptionLabel", "Description")}</Text>
                <Input.TextArea
                  value={editDescription}
                  onChange={(event) => setEditDescription(event.target.value)}
                  rows={2}
                  disabled={selected.status === "archived"}
                />
              </div>
              <div>
                <Flex gap={6} align="center">
                  <Text type="secondary">{t("chat.project.pathLabel", "Project folder")}</Text>
                  {selected.project_path_status !== "configured" ? (
                    <Tag color="warning" style={{ marginInlineEnd: 0 }}>
                      {selected.project_path_status === "needs_selection"
                        ? t("chat.project.pathNeedsSelection")
                        : t("chat.project.pathNeedsConfiguration")}
                    </Tag>
                  ) : null}
                </Flex>
                <Input
                  value={editProjectPath}
                  onChange={(event) => setEditProjectPath(event.target.value)}
                  placeholder={t("chat.workspace.placeholder")}
                  prefix={<FolderOutlined />}
                  disabled={selected.status === "archived"}
                  data-testid="project-detail-path"
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t("chat.project.pathDescription")}
                </Text>
              </div>
              {selected.status === "active" ? (
                <Button
                  size="small"
                  onClick={handleSaveDetail}
                  loading={busy}
                  style={{ alignSelf: "flex-start" }}
                  data-testid="project-detail-save"
                >
                  {t("chat.project.save", "Save")}
                </Button>
              ) : null}

              <Divider style={{ margin: "4px 0" }} />
              <Text strong>{t("chat.project.workspacesTitle", "Additional workspaces")}</Text>
              {selected.workspace_bindings.length === 0 ? (
                <Text type="secondary">{t("chat.project.emptyWorkspaces")}</Text>
              ) : (
                <List
                  size="small"
                  dataSource={selected.workspace_bindings}
                  renderItem={(binding) => (
                    <List.Item
                      style={{ padding: "4px 0" }}
                      actions={
                        selected.status === "active"
                          ? [
                              <Button
                                key="remove"
                                type="text"
                                size="small"
                                danger
                                disabled={busy}
                                icon={<DeleteOutlined />}
                                onClick={() => handleUnbind(binding.path)}
                                aria-label={t("chat.project.unbindWorkspace")}
                              />,
                            ]
                          : undefined
                      }
                    >
                      <Text code style={{ fontSize: 12 }}>
                        {binding.path}
                      </Text>
                    </List.Item>
                  )}
                />
              )}
              {selected.status === "active" ? (
                <Flex gap={8}>
                  <Input
                    value={bindingPath}
                    onChange={(event) => setBindingPath(event.target.value)}
                    placeholder={t("chat.workspace.placeholder")}
                    size="small"
                    data-testid="project-bind-input"
                  />
                  <Button
                    size="small"
                    onClick={handleBind}
                    loading={busy}
                    disabled={!bindingPath.trim()}
                    data-testid="project-bind-submit"
                  >
                    {t("chat.project.addWorkspace", "Bind")}
                  </Button>
                </Flex>
              ) : null}

              <Divider style={{ margin: "4px 0" }} />
              <Text strong>{t("chat.project.resourcesTitle", "Shared resources")}</Text>
              {resourcesError ? (
                <Text type="danger">{t("chat.project.resourcesFailed")}</Text>
              ) : !resources || resources.resources.every((kind) => !kind.present) ? (
                <Text type="secondary">{t("chat.project.resourcesEmpty")}</Text>
              ) : (
                <Flex gap={6} wrap="wrap">
                  {resources.resources
                    .filter((kind) => kind.present)
                    .map((kind) => (
                      <Tag key={kind.kind} icon={<InboxOutlined />}>
                        {kind.kind} ({kind.item_count})
                      </Tag>
                    ))}
                </Flex>
              )}
              {resources ? (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t("chat.project.resourceRevision", { revision: resources.resource_revision })}
                </Text>
              ) : null}

              {selected.status === "active" ? (
                <>
                  <Divider style={{ margin: "4px 0" }} />
                  <Popconfirm
                    title={t("chat.project.archiveConfirmTitle", { name: selected.name })}
                    description={t("chat.project.archiveConfirmContent")}
                    okText={t("chat.project.archive", "Archive")}
                    okButtonProps={{ danger: true }}
                    cancelText={t("common.cancel")}
                    onConfirm={handleArchive}
                  >
                    <Button
                      danger
                      size="small"
                      disabled={busy}
                      style={{ alignSelf: "flex-start" }}
                      data-testid="project-archive"
                    >
                      {t("chat.project.archive", "Archive")}
                    </Button>
                  </Popconfirm>
                </>
              ) : (
                <>
                  <Divider style={{ margin: "4px 0" }} />
                  <Button
                    size="small"
                    icon={<UndoOutlined />}
                    loading={busy}
                    disabled={busy}
                    onClick={handleUnarchive}
                    style={{ alignSelf: "flex-start" }}
                    data-testid="project-unarchive"
                  >
                    {t("chat.project.restore", "Restore")}
                  </Button>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t("chat.project.restoreDescription")}
                  </Text>
                </>
              )}
            </Flex>
          ) : (
            <Empty description={t("chat.project.selectProject", "Select a project to manage")} />
          )}
        </div>
      </Flex>
    </Modal>
  );
};

export default ProjectManagerModal;
