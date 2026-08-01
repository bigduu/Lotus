import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type APIResponse,
  type Page,
  type TestInfo,
} from "@playwright/test";

const DEFAULT_API_ORIGIN = "http://127.0.0.1:9562";
const FIXTURE_PREFIX = "e2e-158-";

export const PROJECT_EXPANSION_STORAGE_KEY = "lotus.sidebar.project.expanded.v1";

export type ProjectManifest = {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  revision: number;
  resource_revision: number;
  project_path: string | null;
  project_path_status: "configured" | "needs_selection" | "needs_configuration";
  workspace_count: number;
  workspace_bindings: Array<{
    path: string;
    label?: string | null;
    git_common_dir?: string | null;
  }>;
  legacy_project_keys: string[];
  schema_version: number;
  created_at: string;
  updated_at: string;
};

export type SessionSummary = {
  id: string;
  kind: "root" | "child";
  title: string;
  title_version: number;
  pinned: boolean;
  parent_session_id: string | null;
  root_session_id: string;
  spawn_depth: number;
  model: string;
  model_ref?: { provider: string; model: string } | null;
  project_id: string | null;
  workspace_path: string | null;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  message_count: number;
  has_attachments: boolean;
  is_running: boolean;
  bypass_permissions?: boolean;
  metadata_version?: number;
  created_by_schedule_id?: string | null;
};

export type WorkspaceFixture = {
  root: string;
  primary: string;
  secondary: string;
  foreign: string;
  legacy: string;
};

export type ScheduleEntry = {
  id: string;
  name: string;
  enabled: boolean;
  run_config: {
    project_id?: string | null;
    workspace_path?: string | null;
    auto_execute?: boolean;
  };
};

type PermissionPolicyResponse = {
  revision: number;
  policy: {
    durable_rules?: Array<{ id: string }>;
  };
};

function apiOrigin(): string {
  return (process.env.E2E_API_URL || DEFAULT_API_ORIGIN).replace(/\/+$/, "");
}

export async function createBackendContext(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL: apiOrigin(),
    extraHTTPHeaders: { "Content-Type": "application/json" },
  });
}

export async function expectApiOk(response: APIResponse, operation: string): Promise<void> {
  if (response.ok()) return;
  throw new Error(
    `${operation} failed: ${response.status()} ${response.statusText()} ${await response.text()}`,
  );
}

export async function configureProjectFirstPage(page: Page): Promise<void> {
  const backendBaseUrl = `${apiOrigin()}/v1`;
  await page.addInitScript(
    ({ baseUrl, expansionKey }) => {
      localStorage.setItem("bodhi_onboarding_complete", "true");
      localStorage.setItem("copilot_backend_base_url", baseUrl);
      localStorage.setItem("lotus_ui_locale_v1", "en-US");
      const resetMarker = "e2e-158-project-expansion-reset";
      if (sessionStorage.getItem(resetMarker) !== "true") {
        localStorage.removeItem(expansionKey);
        sessionStorage.setItem(resetMarker, "true");
      }
    },
    { baseUrl: backendBaseUrl, expansionKey: PROJECT_EXPANSION_STORAGE_KEY },
  );
}

export async function createWorkspaceFixture(
  testInfo: TestInfo,
  label: string,
): Promise<WorkspaceFixture> {
  const slug = `${testInfo.workerIndex}-${testInfo.retry}-${label.replace(/[^a-z0-9]+/gi, "-")}-`;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `${FIXTURE_PREFIX}${slug}`));
  const fixture = {
    root,
    primary: path.join(root, "primary"),
    secondary: path.join(root, "secondary"),
    foreign: path.join(root, "foreign"),
    legacy: path.join(root, "legacy"),
  };
  await Promise.all(
    [fixture.primary, fixture.secondary, fixture.foreign, fixture.legacy].map((directory) =>
      fs.mkdir(directory, { recursive: true }),
    ),
  );
  const [canonicalRoot, primary, secondary, foreign, legacy] = await Promise.all([
    fs.realpath(root),
    fs.realpath(fixture.primary),
    fs.realpath(fixture.secondary),
    fs.realpath(fixture.foreign),
    fs.realpath(fixture.legacy),
  ]);
  return { root: canonicalRoot, primary, secondary, foreign, legacy };
}

export async function removeWorkspaceFixture(fixture: WorkspaceFixture): Promise<void> {
  const basename = path.basename(fixture.root);
  const canonicalTmpDir = await fs.realpath(os.tmpdir());
  if (!basename.startsWith(FIXTURE_PREFIX) || path.dirname(fixture.root) !== canonicalTmpDir) {
    throw new Error(`Refusing to remove an unexpected E2E fixture path: ${fixture.root}`);
  }
  await fs.rm(fixture.root, { recursive: true, force: true });
}

export async function createProject(
  api: APIRequestContext,
  input: { name: string; projectPath: string; description?: string | null },
): Promise<ProjectManifest> {
  const response = await api.post("/api/v1/projects", {
    data: {
      name: input.name,
      description: input.description ?? null,
      project_path: input.projectPath,
    },
  });
  await expectApiOk(response, `create Project ${input.name}`);
  const project = (await response.json()) as ProjectManifest;
  expect(project.id, "created Project id").toBeTruthy();
  expect(project.project_path, "created Project path").toBe(input.projectPath);
  expect(project.revision, "created Project revision").toBeGreaterThan(0);
  return project;
}

export async function getProject(
  api: APIRequestContext,
  projectId: string,
): Promise<ProjectManifest> {
  const response = await api.get(`/api/v1/projects/${encodeURIComponent(projectId)}`);
  await expectApiOk(response, `get Project ${projectId}`);
  return response.json();
}

export async function patchProject(
  api: APIRequestContext,
  projectId: string,
  revision: number,
  patch: Record<string, unknown>,
): Promise<ProjectManifest> {
  const response = await api.patch(`/api/v1/projects/${encodeURIComponent(projectId)}`, {
    headers: { "If-Match": `"${revision}"` },
    data: patch,
  });
  await expectApiOk(response, `patch Project ${projectId}`);
  return response.json();
}

export async function bindWorkspace(
  api: APIRequestContext,
  project: ProjectManifest,
  workspacePath: string,
  label: string | null = null,
): Promise<ProjectManifest> {
  const response = await api.post(`/api/v1/projects/${encodeURIComponent(project.id)}/workspaces`, {
    headers: { "If-Match": `"${project.revision}"` },
    data: { path: workspacePath, label, git_common_dir: null },
  });
  await expectApiOk(response, `bind workspace to Project ${project.id}`);
  return response.json();
}

export async function archiveProject(api: APIRequestContext, projectId: string): Promise<void> {
  const projectResponse = await api.get(`/api/v1/projects/${encodeURIComponent(projectId)}`);
  if (projectResponse.status() === 404) return;
  await expectApiOk(projectResponse, `load Project ${projectId} for cleanup`);
  const project = (await projectResponse.json()) as ProjectManifest;
  if (project.status === "archived") return;
  const response = await api.post(`/api/v1/projects/${encodeURIComponent(projectId)}/archive`, {
    headers: { "If-Match": `"${project.revision}"` },
    data: {},
  });
  await expectApiOk(response, `archive Project ${projectId}`);
}

export async function createSession(
  api: APIRequestContext,
  input: {
    title: string;
    projectId?: string | null;
    workspacePath?: string | null;
    systemPrompt?: string;
  },
): Promise<SessionSummary> {
  const response = await api.post("/api/v1/sessions", {
    data: {
      title: input.title,
      system_prompt: input.systemPrompt ?? "You are an E2E fixture.",
      model: "e2e-model",
      project_id: input.projectId ?? null,
      workspace_path: input.workspacePath ?? null,
    },
  });
  await expectApiOk(response, `create session ${input.title}`);
  const body = (await response.json()) as { session: SessionSummary };
  expect(body.session?.id, "created session id").toBeTruthy();
  expect(body.session.title, "created session title").toBe(input.title);
  expect(body.session.project_id, "created session Project").toBe(input.projectId ?? null);
  return body.session;
}

export async function getSessionWithVersion(
  api: APIRequestContext,
  sessionId: string,
): Promise<{ session: SessionSummary; metadataVersion: number }> {
  const response = await api.get(`/api/v1/sessions/${encodeURIComponent(sessionId)}`);
  await expectApiOk(response, `get session ${sessionId}`);
  const body = (await response.json()) as { session: SessionSummary };
  const rawEtag = response.headers()["etag"];
  expect(rawEtag, `session ${sessionId} ETag`).toMatch(/^"\d+"$/);
  if (!rawEtag) {
    throw new Error(`Session ${sessionId} did not expose an ETag`);
  }
  const metadataVersion = Number(rawEtag.replaceAll('"', ""));
  if (!Number.isInteger(metadataVersion)) {
    throw new Error(`Session ${sessionId} did not expose a metadata revision`);
  }
  return { session: body.session, metadataVersion };
}

export async function patchSession(
  api: APIRequestContext,
  sessionId: string,
  patch: Record<string, unknown>,
): Promise<SessionSummary> {
  const { metadataVersion } = await getSessionWithVersion(api, sessionId);
  const response = await api.patch(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { "If-Match": `"${metadataVersion}"` },
    data: patch,
  });
  await expectApiOk(response, `patch session ${sessionId}`);
  const body = (await response.json()) as { session: SessionSummary };
  return body.session;
}

export async function deleteSession(api: APIRequestContext, sessionId: string): Promise<void> {
  const response = await api.delete(`/api/v1/sessions/${encodeURIComponent(sessionId)}`);
  if (response.status() === 404) return;
  await expectApiOk(response, `delete session ${sessionId}`);
}

export async function createChildDraft(
  api: APIRequestContext,
  parentSessionId: string,
  input: { title: string; workspacePath: string },
): Promise<SessionSummary> {
  const response = await api.post("/v1/tools/execute", {
    data: {
      tool_name: "SubAgent",
      session_id: parentSessionId,
      parameters: [
        { name: "action", value: "create" },
        { name: "title", value: input.title },
        { name: "responsibility", value: "Verify Project inheritance in E2E" },
        { name: "prompt", value: "Remain idle; this child is an E2E fixture." },
        { name: "workspace", value: input.workspacePath },
        { name: "auto_run", value: "false" },
      ],
    },
  });
  await expectApiOk(response, `create child for session ${parentSessionId}`);
  const outer = (await response.json()) as { result?: string };
  expect(outer.result, "tool response payload").toBeTruthy();
  const toolPayload = JSON.parse(outer.result || "{}") as {
    success?: boolean;
    result?: string;
  };
  expect(toolPayload.success, "SubAgent tool success").toBe(true);
  const childPayload = JSON.parse(toolPayload.result || "{}") as {
    child_session_id?: string;
  };
  expect(childPayload.child_session_id, "SubAgent child_session_id").toBeTruthy();
  return (await getSessionWithVersion(api, childPayload.child_session_id || "")).session;
}

export async function allowSubAgentCreateForTest(
  api: APIRequestContext,
  suffix: string,
): Promise<{ ruleId: string; cleanup: () => Promise<void> }> {
  const safeSuffix = suffix.replace(/[^a-z0-9-]+/gi, "-");
  const ruleId = `${FIXTURE_PREFIX}subagent-${safeSuffix}`;
  const rule = {
    id: ruleId,
    permission_type: "execute_command",
    effect: "allow",
    scope: "global",
    matcher: {
      id: `${ruleId}-matcher`,
      kind: "tool_action",
      value: "SubAgent create",
    },
    source: "user",
  };

  let created = false;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const policyResponse = await api.get("/v1/bamboo/permission/policy");
    await expectApiOk(policyResponse, "load permission policy before E2E rule create");
    const policy = (await policyResponse.json()) as PermissionPolicyResponse;
    expect(policy.revision, "permission policy revision").toBeGreaterThanOrEqual(0);
    expect(policy.policy, "permission policy body").toBeTruthy();
    const response = await api.post("/v1/bamboo/permission/rules", {
      data: { expected_revision: policy.revision, rule },
    });
    if (response.ok()) {
      created = true;
      break;
    }
    if (response.status() !== 409) {
      await expectApiOk(response, `create permission rule ${ruleId}`);
    }
  }
  if (!created) {
    throw new Error(`Could not create permission rule ${ruleId} after CAS retries`);
  }

  return {
    ruleId,
    cleanup: async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const policyResponse = await api.get("/v1/bamboo/permission/policy");
        await expectApiOk(policyResponse, "load permission policy before E2E rule cleanup");
        const policy = (await policyResponse.json()) as PermissionPolicyResponse;
        if (!(policy.policy.durable_rules ?? []).some((candidate) => candidate.id === ruleId)) {
          return;
        }
        const response = await api.delete(
          `/v1/bamboo/permission/rules/${encodeURIComponent(ruleId)}?expected_revision=${policy.revision}`,
        );
        if (response.ok() || response.status() === 404) {
          return;
        }
        if (response.status() !== 409) {
          await expectApiOk(response, `delete permission rule ${ruleId}`);
        }
      }
      throw new Error(`Could not delete permission rule ${ruleId} after CAS retries`);
    },
  };
}

export async function runScheduleNow(api: APIRequestContext, scheduleId: string): Promise<void> {
  const response = await api.post(`/api/v1/schedules/${encodeURIComponent(scheduleId)}/run`, {
    data: {},
  });
  await expectApiOk(response, `run schedule ${scheduleId}`);
}

export async function waitForScheduleSession(
  api: APIRequestContext,
  scheduleId: string,
  timeoutMs = 20_000,
): Promise<SessionSummary> {
  const deadline = Date.now() + timeoutMs;
  let lastBody = "";
  while (Date.now() < deadline) {
    const response = await api.get(`/api/v1/schedules/${encodeURIComponent(scheduleId)}/sessions`);
    await expectApiOk(response, `list sessions for schedule ${scheduleId}`);
    lastBody = await response.text();
    const body = JSON.parse(lastBody) as { sessions?: SessionSummary[] };
    if (body.sessions?.[0]) {
      return body.sessions[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Schedule ${scheduleId} created no session within ${timeoutMs}ms: ${lastBody}`);
}

export async function deleteSchedule(api: APIRequestContext, scheduleId: string): Promise<void> {
  const response = await api.delete(`/api/v1/schedules/${encodeURIComponent(scheduleId)}`);
  if (response.status() === 404) return;
  await expectApiOk(response, `delete schedule ${scheduleId}`);
}

export async function writeProjectCommandResource(
  projectId: string,
  suffix: string,
): Promise<{ filePath: string; cleanup: () => Promise<void> }> {
  const dataDir = process.env.E2E_DATA_DIR;
  if (!dataDir) {
    throw new Error("E2E_DATA_DIR is required for the Project resource watcher scenario");
  }
  const filename = `${FIXTURE_PREFIX}resource-${suffix.replace(/[^a-z0-9-]+/gi, "-")}.md`;
  const commandsDir = path.join(dataDir, "projects", projectId, "commands");
  const filePath = path.join(commandsDir, filename);
  await fs.mkdir(commandsDir, { recursive: true });
  await fs.writeFile(
    filePath,
    "# E2E Project command\n\nProject-scoped resource fixture.\n",
    "utf8",
  );

  return {
    filePath,
    cleanup: async () => {
      if (!path.basename(filePath).startsWith(`${FIXTURE_PREFIX}resource-`)) {
        throw new Error(`Refusing to remove an unexpected resource fixture: ${filePath}`);
      }
      await fs.rm(filePath, { force: true });
    },
  };
}

export async function openProjectManager(page: Page) {
  await expect(page.getByTestId("open-project-manager")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("open-project-manager").click();
  const dialog = page.getByRole("dialog", { name: "Projects & workspaces" });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function closeDialog(dialog: ReturnType<Page["getByRole"]>): Promise<void> {
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
}

export function sessionRow(page: Page, title: string) {
  return page.locator('[data-testid="chat-item"]').filter({ hasText: title });
}

export async function openSessionProjectPicker(page: Page, sessionTitle: string) {
  const row = sessionRow(page, sessionTitle);
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.locator('[data-testid="chat-input"]')).toBeVisible();
  const dialog = page.getByRole("dialog", { name: "Assign session to Project" });
  const referenceButton = page.getByRole("button", { name: "Reference workspace files" });

  // Session-detail hydration can remount the transient file card once. Retry
  // the short bridge into the durable modal instead of retaining a detached
  // button from that card.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await referenceButton.click();
    const fileCard = page.locator(".ant-card").filter({ hasText: "@ File Reference" });
    const setProjectButton = fileCard.getByRole("button", { name: "Set Project" });
    try {
      await expect(setProjectButton).toBeVisible({ timeout: 3_000 });
      await setProjectButton.evaluate((button: HTMLButtonElement) => button.click());
      await expect(dialog).toBeVisible({ timeout: 3_000 });
      return dialog;
    } catch {
      if (await dialog.isVisible().catch(() => false)) {
        return dialog;
      }
    }
  }

  throw new Error(`Project picker did not open for session ${sessionTitle}`);
}

export async function selectSessionProject(
  page: Page,
  dialog: ReturnType<Page["getByRole"]>,
  projectName: string,
): Promise<void> {
  await dialog.getByTestId("session-project-select").click();
  const option = page.locator(".ant-select-item-option").filter({ hasText: projectName });
  await expect(option).toBeVisible();
  await option.click();
}

export async function cleanupProjectFixture(
  api: APIRequestContext,
  fixture: WorkspaceFixture,
  sessionIds: string[],
  projectIds: string[],
): Promise<void> {
  for (const sessionId of [...sessionIds].reverse()) {
    await deleteSession(api, sessionId);
  }
  for (const projectId of [...projectIds].reverse()) {
    await archiveProject(api, projectId);
  }
  await removeWorkspaceFixture(fixture);
}
