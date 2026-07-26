import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import { DeleteOutlined, FolderOutlined, InboxOutlined, PlusOutlined } from "@ant-design/icons";
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

/**
 * Project manager (#154): create / rename / archive Projects and manage
 * their workspace bindings + read-only shared-resource summary.
 *
 * Deliberately out of scope until the backend lands:
 * - restore/unarchive (Bamboo-agent#725),
 * - default workspace selection (Bamboo-agent#692),
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
      bindWorkspace: state.bindWorkspace,
      unbindWorkspace: state.unbindWorkspace,
      ensureProject: state.ensureProject,
      loadProjectResources: state.loadProjectResources,
      projectResources: state.projectResources,
      projectResourcesError: state.projectResourcesError,
    })),
  );

  const sortedProjects = useMemo(
    () =>
      Object.values(projects).sort((a, b) => {
        if (a.status !== b.status) return a.status === "active" ? -1 : 1;
        return b.updated_at.localeCompare(a.updated_at);
      }),
    [projects],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  // Unassigned root sessions — the entry point to the legacy migration
  // wizard (#156). Children inherit their root's project on the backend.
  const unassignedRootCount = useAppStore(
    (state) => state.chats.filter((chat) => chat.kind !== "child" && !chat.config.projectId).length,
  );

  // Create form
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newWorkspace, setNewWorkspace] = useState("");

  // Detail form
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [bindingPath, setBindingPath] = useState("");

  const selected: ProjectManifest | null = selectedId ? (projects[selectedId] ?? null) : null;
  const resources = selectedId ? projectResources[selectedId] : undefined;
  const resourcesError = selectedId ? projectResourcesError[selectedId] : undefined;

  // Pick a sensible selection when the modal opens or the list changes.
  useEffect(() => {
    if (!open) return;
    if (selectedId && projects[selectedId]) return;
    const fallback = activeProjectId && projects[activeProjectId] ? activeProjectId : null;
    setSelectedId(fallback ?? sortedProjects[0]?.id ?? null);
  }, [open, projects, selectedId, activeProjectId, sortedProjects]);

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
            if (fresh) {
              setEditName(fresh.name);
              setEditDescription(fresh.description ?? "");
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
    setBusy(true);
    try {
      const manifest = await createProject({
        name,
        description: newDescription.trim() || null,
        workspace_bindings: newWorkspace.trim()
          ? [{ path: newWorkspace.trim(), label: null, git_common_dir: null }]
          : [],
      });
      setCreating(false);
      setNewName("");
      setNewDescription("");
      setNewWorkspace("");
      setSelectedId(manifest.id);
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
    setBusy(true);
    try {
      await updateProject(selected.id, selected.revision, {
        name,
        description: editDescription.trim() || null,
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
          <List
            size="small"
            dataSource={sortedProjects}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
            renderItem={(project) => (
              <List.Item
                onClick={() => {
                  setCreating(false);
                  setSelectedId(project.id);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setCreating(false);
                    setSelectedId(project.id);
                  }
                }}
                style={{
                  cursor: "pointer",
                  padding: "6px 8px",
                  borderRadius: token.borderRadiusSM,
                  background:
                    project.id === selectedId && !creating ? token.colorFillSecondary : undefined,
                }}
                data-testid={`project-list-item-${project.id}`}
              >
                <Flex align="center" gap={6} style={{ minWidth: 0 }}>
                  <Text ellipsis style={{ flex: 1 }}>
                    {project.name}
                  </Text>
                  {project.status === "archived" ? (
                    <Tag style={{ marginInlineEnd: 0 }}>
                      {t("chat.project.archivedTag", "Archived")}
                    </Tag>
                  ) : null}
                </Flex>
              </List.Item>
            )}
          />
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
                <Text type="secondary">
                  {t("chat.project.initialWorkspaceLabel", "Initial workspace (optional)")}
                </Text>
                <Input
                  value={newWorkspace}
                  onChange={(event) => setNewWorkspace(event.target.value)}
                  placeholder={t("chat.workspace.placeholder")}
                  prefix={<FolderOutlined />}
                  data-testid="project-create-workspace"
                />
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
              <Text strong>{t("chat.project.workspacesTitle", "Bound workspaces")}</Text>
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
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t("chat.project.restoreUnavailable")}
                </Text>
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
