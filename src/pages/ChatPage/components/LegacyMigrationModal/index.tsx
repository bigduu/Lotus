import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  App as AntdApp,
  Alert,
  Button,
  Checkbox,
  Collapse,
  Flex,
  Input,
  List,
  Modal,
  Select,
  Spin,
  Tag,
  Typography,
} from "antd";
import { FolderOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";

import { useAppStore } from "@shared/store/appStore";
import { AgentClient } from "@services/chat/AgentService";
import { isApiError } from "@services/api";
import { projectService } from "@services/project";
import type {
  LegacyMemoryMigrationReport,
  LegacyProjectDryRunReport,
  LegacyProjectSuggestion,
} from "@services/project";

const { Text } = Typography;

type LegacyMigrationModalProps = {
  open: boolean;
  onClose: () => void;
};

type SuggestionTarget =
  | { mode: "skip" }
  | { mode: "existing"; projectId: string }
  | { mode: "new"; name: string; projectPath: string };

type ApplyStatus = { status: "pending" | "ok" | "failed"; reason?: string };

const NEW_PROJECT_OPTION = "__create_new__";
const SKIP_OPTION = "__skip__";

const suggestionKey = (suggestion: LegacyProjectSuggestion): string =>
  `${suggestion.basis}:${[...suggestion.session_ids].sort().join(",")}`;

const defaultNewProjectName = (suggestion: LegacyProjectSuggestion): string => {
  // Prefill from the suggestion's own data as a *starting point* — the user
  // must still confirm ( Lotus #134: never auto-create one project per path).
  const source = suggestion.legacy_project_keys[0] ?? suggestion.workspace_paths[0] ?? "";
  const segments = source
    .replace(/[/\\]+$/, "")
    .split(/[/\\]+/)
    .filter(Boolean);
  return segments[segments.length - 1] ?? "";
};

/**
 * Legacy session migration wizard (#156): dry-run analysis of unassigned
 * sessions, user-confirmed batch assignment (existing or newly created
 * Projects), optional legacy-memory migration, and a skip path that leaves
 * everything reachable in the Unassigned group.
 */
const LegacyMigrationModal: React.FC<LegacyMigrationModalProps> = ({ open, onClose }) => {
  const { t } = useTranslation();
  const { message } = AntdApp.useApp();
  const {
    chats,
    projects,
    legacyDryRun,
    createProject,
    migrateLegacyMemory,
    refreshChats,
    loadProjects,
  } = useAppStore(
    useShallow((state) => ({
      chats: state.chats,
      projects: state.projects,
      legacyDryRun: state.legacyDryRun,
      createProject: state.createProject,
      migrateLegacyMemory: state.migrateLegacyMemory,
      refreshChats: state.refreshChats,
      loadProjects: state.loadProjects,
    })),
  );

  const [report, setReport] = useState<LegacyProjectDryRunReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checkedSessions, setCheckedSessions] = useState<Set<string>>(new Set());
  const [targets, setTargets] = useState<Record<string, SuggestionTarget>>({});
  const [memoryKeys, setMemoryKeys] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [applyResults, setApplyResults] = useState<Record<string, ApplyStatus>>({});
  const [memoryReports, setMemoryReports] = useState<Record<string, LegacyMemoryMigrationReport>>(
    {},
  );
  const dryRunAttemptedRef = useRef(false);

  const unassignedRoots = useMemo(
    () => chats.filter((chat) => chat.kind !== "child" && !chat.config.projectId),
    [chats],
  );

  const projectName = useCallback(
    (projectId: string) => projects[projectId]?.name ?? projectId,
    [projects],
  );

  const sessionTitle = useCallback(
    (sessionId: string) => chats.find((chat) => chat.id === sessionId)?.title ?? sessionId,
    [chats],
  );

  // Run the dry-run when the modal opens — and again if the sessions list
  // only finishes loading while the modal is already open (roots go 0 → N).
  useEffect(() => {
    if (!open) {
      dryRunAttemptedRef.current = false;
      return;
    }
    if (dryRunAttemptedRef.current) return;
    if (unassignedRoots.length === 0) return;
    dryRunAttemptedRef.current = true;

    setReport(null);
    setLoadError(null);
    setApplyResults({});
    setMemoryReports({});
    setApplying(false);

    const roots = unassignedRoots;
    setLoading(true);
    legacyDryRun(
      roots.map((chat) => ({
        session_id: chat.id,
        workspace_path: chat.config.workspacePath ?? null,
        // Bamboo owns canonical-path, Git common-dir, and legacy-key
        // enrichment. Sending client guesses here can suppress the server's
        // authoritative derivation for worktrees and older session metadata.
      })),
    )
      .then((nextReport) => {
        setReport(nextReport);
        setCheckedSessions(new Set(nextReport.assignments.map((a) => a.session_id)));
        const nextTargets: Record<string, SuggestionTarget> = {};
        for (const suggestion of nextReport.suggestions) {
          nextTargets[suggestionKey(suggestion)] = { mode: "skip" };
        }
        setTargets(nextTargets);
        setMemoryKeys(new Set());
      })
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, unassignedRoots.length]);

  const activeProjectOptions = useMemo(
    () =>
      Object.values(projects)
        .filter((project) => project.status === "active")
        .map((project) => ({ value: project.id, label: project.name })),
    [projects],
  );

  /** Assign one session with the required If-Match, retrying once on 412. */
  const assignSession = useCallback(
    async (sessionId: string, projectId: string): Promise<void> => {
      const client = AgentClient.getInstance();
      const attempt = async () => {
        const { metadataVersion } = await client.getSessionWithVersion(sessionId);
        if (metadataVersion === null) {
          throw new Error(t("chat.migration.noVersion"));
        }
        await client.reassignSessionProject(sessionId, projectId, metadataVersion);
      };
      try {
        await attempt();
      } catch (error) {
        if (isApiError(error) && error.status === 412) {
          await attempt(); // one retry with a freshly-read version
          return;
        }
        if (isApiError(error) && error.status === 409) {
          // `session_project_running_conflict` — reassignment is only
          // allowed while the session is idle.
          throw new Error(t("chat.migration.runningConflict"));
        }
        throw error;
      }
    },
    [t],
  );

  const resolvedSuggestionAssignments = useMemo(() => {
    if (!report) return [];
    const resolved: { sessionId: string; target: SuggestionTarget; key: string }[] = [];
    for (const suggestion of report.suggestions) {
      const key = suggestionKey(suggestion);
      const target = targets[key] ?? { mode: "skip" as const };
      if (target.mode === "skip") continue;
      for (const sessionId of suggestion.session_ids) {
        resolved.push({ sessionId, target, key });
      }
    }
    return resolved;
  }, [report, targets]);

  const applyCount = checkedSessions.size + resolvedSuggestionAssignments.length;

  const pollMemoryMigration = useCallback(
    async (projectId: string, legacyKey: string) => {
      let lastPhase: string | null = null;
      for (let attempt = 0; attempt < 15; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const status = await projectService.getLegacyMemoryMigrationStatus(projectId, legacyKey);
        lastPhase = status.migration.phase;
        setMemoryReports((prev) => ({ ...prev, [legacyKey]: status.migration }));
        if (status.migration.phase === "committed") return;
      }
      if (lastPhase !== "committed") {
        message.warning(t("chat.migration.memoryPending"));
      }
    },
    [message, t],
  );

  const handleApply = async () => {
    if (!report) return;
    // A "create new project" suggestion needs an explicitly-confirmed name
    // and primary path before anything runs. Never promote a suggested
    // workspace implicitly (Bamboo #692 migration invariant).
    const missingName = resolvedSuggestionAssignments.some(
      ({ target }) => target.mode === "new" && !target.name.trim(),
    );
    if (missingName) {
      message.error(t("chat.project.nameRequired"));
      return;
    }
    const missingProjectPath = resolvedSuggestionAssignments.some(
      ({ target }) => target.mode === "new" && !target.projectPath.trim(),
    );
    if (missingProjectPath) {
      message.error(t("chat.project.pathRequired"));
      return;
    }
    setApplying(true);
    const results: Record<string, ApplyStatus> = {};
    setApplyResults({});

    // 1. Create new projects requested by suggestions (target resolution).
    const projectIdByKey: Record<string, string> = {};
    try {
      for (const { target, key } of resolvedSuggestionAssignments) {
        if (target.mode === "new" && !projectIdByKey[key]) {
          const manifest = await createProject({
            name: target.name.trim(),
            description: null,
            project_path: target.projectPath.trim(),
          });
          projectIdByKey[key] = manifest.id;
        }
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("chat.project.createFailed"));
      setApplying(false);
      return;
    }

    // 2. Assign sessions — direct assignments first, then suggestions.
    const assignments: { sessionId: string; projectId: string }[] = [];
    for (const assignment of report.assignments) {
      if (checkedSessions.has(assignment.session_id)) {
        assignments.push({ sessionId: assignment.session_id, projectId: assignment.project_id });
      }
    }
    for (const { sessionId, target, key } of resolvedSuggestionAssignments) {
      const projectId =
        target.mode === "new"
          ? projectIdByKey[key]
          : target.mode === "existing"
            ? target.projectId
            : undefined;
      if (projectId) assignments.push({ sessionId, projectId });
    }

    for (const { sessionId, projectId } of assignments) {
      results[sessionId] = { status: "pending" };
      setApplyResults({ ...results });
      try {
        await assignSession(sessionId, projectId);
        results[sessionId] = { status: "ok" };
      } catch (error) {
        results[sessionId] = {
          status: "failed",
          reason: error instanceof Error ? error.message : String(error),
        };
      }
      setApplyResults({ ...results });
    }

    // 3. Optional legacy-memory migration for opted-in keys.
    for (const legacyKey of memoryKeys) {
      // Find the target project chosen for the suggestion carrying this key.
      const suggestion = report.suggestions.find((s) => s.legacy_project_keys.includes(legacyKey));
      if (!suggestion) continue;
      const target = targets[suggestionKey(suggestion)];
      if (!target || target.mode === "skip") continue;
      const projectId =
        target.mode === "new"
          ? projectIdByKey[suggestionKey(suggestion)]
          : target.mode === "existing"
            ? target.projectId
            : undefined;
      if (!projectId) continue;
      try {
        const revision = useAppStore.getState().projects[projectId]?.revision ?? 0;
        const response = await migrateLegacyMemory(projectId, revision, legacyKey);
        setMemoryReports((prev) => ({ ...prev, [legacyKey]: response.migration }));
        await pollMemoryMigration(projectId, legacyKey);
      } catch (error) {
        message.warning(error instanceof Error ? error.message : String(error));
      }
    }

    // 4. Reconcile the sidebar + project store with the backend.
    await Promise.all([refreshChats().catch(() => {}), loadProjects().catch(() => {})]);
    setApplying(false);
  };

  const okCount = Object.values(applyResults).filter((r) => r.status === "ok").length;
  const failedCount = Object.values(applyResults).filter((r) => r.status === "failed").length;
  const finished = Object.keys(applyResults).length > 0 && !applying;

  return (
    <Modal
      open={open}
      title={t("chat.migration.title")}
      footer={null}
      onCancel={onClose}
      width={720}
      destroyOnClose
      closable={!applying}
      maskClosable={!applying}
    >
      {loading ? (
        <Flex justify="center" align="center" gap={8} style={{ padding: 32 }}>
          <Spin size="small" />
          <Text type="secondary">{t("chat.migration.loading")}</Text>
        </Flex>
      ) : loadError ? (
        <Alert type="error" message={t("chat.migration.loadFailed")} description={loadError} />
      ) : unassignedRoots.length === 0 && !report ? (
        <Alert type="info" message={t("chat.migration.nothingToMigrate")} />
      ) : report ? (
        <Flex vertical gap={16}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t("chat.migration.childrenInherit")}
          </Text>

          {report.assignments.length > 0 ? (
            <div>
              <Text strong>
                {t("chat.migration.assignmentsTitle", { count: report.assignments.length })}
              </Text>
              <List
                size="small"
                dataSource={report.assignments}
                renderItem={(assignment) => (
                  <List.Item style={{ padding: "4px 0" }}>
                    <Checkbox
                      checked={checkedSessions.has(assignment.session_id)}
                      disabled={applying}
                      onChange={(event) => {
                        setCheckedSessions((prev) => {
                          const next = new Set(prev);
                          if (event.target.checked) next.add(assignment.session_id);
                          else next.delete(assignment.session_id);
                          return next;
                        });
                      }}
                    >
                      <Text>{sessionTitle(assignment.session_id)}</Text>
                    </Checkbox>
                    <Flex gap={6} align="center">
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        → {projectName(assignment.project_id)}
                      </Text>
                      <Tag style={{ marginInlineEnd: 0 }}>
                        {assignment.basis === "exact_canonical_binding"
                          ? t("chat.migration.basisExact")
                          : t("chat.migration.basisGit")}
                      </Tag>
                      {applyResults[assignment.session_id] ? (
                        <ApplyStatusTag status={applyResults[assignment.session_id]} />
                      ) : null}
                    </Flex>
                  </List.Item>
                )}
              />
            </div>
          ) : null}

          {report.suggestions.length > 0 ? (
            <div>
              <Text strong>
                {t("chat.migration.suggestionsTitle", { count: report.suggestions.length })}
              </Text>
              <List
                size="small"
                dataSource={report.suggestions}
                renderItem={(suggestion) => {
                  const key = suggestionKey(suggestion);
                  const target = targets[key] ?? { mode: "skip" as const };
                  const selectValue =
                    target.mode === "skip"
                      ? SKIP_OPTION
                      : target.mode === "new"
                        ? NEW_PROJECT_OPTION
                        : target.projectId;
                  return (
                    <List.Item style={{ padding: "8px 0" }}>
                      <Flex vertical gap={6} style={{ width: "100%" }}>
                        <Flex gap={8} align="center" wrap="wrap">
                          <Tag>{t("chat.migration.basisGit")}</Tag>
                          <Text>
                            {t("chat.migration.sessionCount", {
                              count: suggestion.session_ids.length,
                            })}
                          </Text>
                          {suggestion.workspace_paths.map((path) => (
                            <Text key={path} code style={{ fontSize: 11 }}>
                              {path}
                            </Text>
                          ))}
                        </Flex>
                        <Flex gap={8} align="center" wrap="wrap">
                          <Text type="secondary">{t("chat.migration.targetProject")}</Text>
                          <Select
                            size="small"
                            style={{ minWidth: 200 }}
                            disabled={applying}
                            value={selectValue}
                            options={[
                              { value: SKIP_OPTION, label: t("chat.migration.skip") },
                              ...activeProjectOptions,
                              {
                                value: NEW_PROJECT_OPTION,
                                label: t("chat.migration.createNewProject"),
                              },
                            ]}
                            onChange={(value) => {
                              setTargets((prev) => ({
                                ...prev,
                                [key]:
                                  value === SKIP_OPTION
                                    ? { mode: "skip" }
                                    : value === NEW_PROJECT_OPTION
                                      ? {
                                          mode: "new",
                                          name: defaultNewProjectName(suggestion),
                                          projectPath: "",
                                        }
                                      : { mode: "existing", projectId: value },
                              }));
                            }}
                            data-testid={`migration-target-${key}`}
                          />
                          {target.mode === "new" ? (
                            <Input
                              size="small"
                              style={{ width: 180 }}
                              disabled={applying}
                              value={target.name}
                              placeholder={t("chat.migration.newProjectName")}
                              onChange={(event) =>
                                setTargets((prev) => ({
                                  ...prev,
                                  [key]: { ...target, name: event.target.value },
                                }))
                              }
                            />
                          ) : null}
                          {target.mode === "new" ? (
                            <Input
                              size="small"
                              style={{ width: 240 }}
                              disabled={applying}
                              value={target.projectPath}
                              placeholder={t("chat.migration.newProjectPath")}
                              prefix={<FolderOutlined />}
                              onChange={(event) =>
                                setTargets((prev) => ({
                                  ...prev,
                                  [key]: { ...target, projectPath: event.target.value },
                                }))
                              }
                            />
                          ) : null}
                          {suggestion.legacy_project_keys.length > 0 && target.mode !== "skip" ? (
                            <Checkbox
                              disabled={applying}
                              checked={suggestion.legacy_project_keys.every((legacyKey) =>
                                memoryKeys.has(legacyKey),
                              )}
                              onChange={(event) => {
                                setMemoryKeys((prev) => {
                                  const next = new Set(prev);
                                  for (const legacyKey of suggestion.legacy_project_keys) {
                                    if (event.target.checked) next.add(legacyKey);
                                    else next.delete(legacyKey);
                                  }
                                  return next;
                                });
                              }}
                            >
                              {t("chat.migration.migrateMemory")}
                            </Checkbox>
                          ) : null}
                        </Flex>
                        {suggestion.legacy_project_keys.map((legacyKey) =>
                          memoryReports[legacyKey] ? (
                            <Text key={legacyKey} type="secondary" style={{ fontSize: 12 }}>
                              {t("chat.migration.memoryPhase", {
                                phase: memoryReports[legacyKey].phase,
                              })}
                            </Text>
                          ) : null,
                        )}
                      </Flex>
                    </List.Item>
                  );
                }}
              />
            </div>
          ) : null}

          {report.unassigned.length > 0 ? (
            <div>
              <Text strong>
                {t("chat.migration.unassignedTitle", { count: report.unassigned.length })}
              </Text>
              <List
                size="small"
                dataSource={report.unassigned}
                renderItem={(item) => (
                  <List.Item style={{ padding: "4px 0" }}>
                    <Text>{sessionTitle(item.session_id)}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {item.reason}
                    </Text>
                  </List.Item>
                )}
              />
            </div>
          ) : null}

          {report.diagnostics.length > 0 ? (
            <Collapse
              size="small"
              items={[
                {
                  key: "diagnostics",
                  label: t("chat.migration.diagnosticsTitle"),
                  children: (
                    <List
                      size="small"
                      dataSource={report.diagnostics}
                      renderItem={(line) => (
                        <List.Item style={{ padding: "2px 0" }}>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {line}
                          </Text>
                        </List.Item>
                      )}
                    />
                  ),
                },
              ]}
            />
          ) : null}

          {finished ? (
            <Alert
              type={failedCount > 0 ? "warning" : "success"}
              message={t("chat.migration.done", { ok: okCount, failed: failedCount })}
            />
          ) : null}

          <Flex gap={8} justify="flex-end">
            <Button onClick={onClose} disabled={applying}>
              {finished ? t("chat.migration.close") : t("chat.migration.skip")}
            </Button>
            {!finished ? (
              <Button
                type="primary"
                loading={applying}
                disabled={applyCount === 0}
                onClick={handleApply}
                data-testid="migration-apply"
              >
                {applying
                  ? t("chat.migration.applying")
                  : t("chat.migration.apply", { count: applyCount })}
              </Button>
            ) : null}
          </Flex>
        </Flex>
      ) : null}
    </Modal>
  );
};

const ApplyStatusTag: React.FC<{ status: ApplyStatus }> = ({ status }) => {
  if (status.status === "pending") {
    return <Spin size="small" />;
  }
  if (status.status === "ok") {
    return <Tag color="success">OK</Tag>;
  }
  return (
    <Text type="danger" style={{ fontSize: 12 }} title={status.reason}>
      {status.reason}
    </Text>
  );
};

export default LegacyMigrationModal;
