import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type Response as PlaywrightResponse,
  type TestInfo,
} from "@playwright/test";

import {
  PROJECT_EXPANSION_STORAGE_KEY,
  allowSubAgentCreateForTest,
  bindWorkspace,
  cleanupProjectFixture,
  closeDialog,
  configureProjectFirstPage,
  createBackendContext,
  createChildDraft,
  createProject,
  createSession,
  createWorkspaceFixture,
  deleteSchedule,
  getProject,
  getSessionWithVersion,
  openProjectManager,
  openSessionProjectPicker,
  patchSession,
  runScheduleNow,
  selectSessionProject,
  sessionRow,
  waitForScheduleSession,
  writeProjectCommandResource,
  type ProjectManifest,
  type ScheduleEntry,
  type SessionSummary,
} from "../utils/project-first-helpers";

const expectGroupExpanded = async (page: Page, name: string, count: number) => {
  const group = page.getByRole("button", { name: `${name} (${count})` });
  await expect(group).toBeVisible({ timeout: 20_000 });
  if ((await group.getAttribute("aria-expanded")) !== "true") {
    await group.click();
  }
  await expect(group).toHaveAttribute("aria-expanded", "true");
  return group;
};

const loadChat = async (page: Page) => {
  await page.goto("/chat");
  await expect(page.getByTestId("project-switcher")).toBeVisible({ timeout: 20_000 });
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const exactGroupName = (groupName: string, count: number) =>
  new RegExp(`^${escapeRegExp(groupName)} \\(${count}\\)$`);

const findGroupWithCount = async (page: Page, groupName: string) => {
  const accessibleName = new RegExp(`^${escapeRegExp(groupName)} \\((\\d+)\\)$`);
  const group = page.getByRole("button", { name: accessibleName });
  await expect(group).toBeVisible();
  const match = (await group.getAttribute("aria-label"))?.match(accessibleName);
  if (!match) {
    throw new Error(`Could not read the session count for Project group ${groupName}`);
  }
  return { group, count: Number(match[1]) };
};

test.describe("Project-first real Bamboo workflows (#158)", () => {
  test.describe.configure({ mode: "serial" });

  let api: APIRequestContext;

  test.beforeEach(async ({ page }) => {
    api = await createBackendContext();
    await configureProjectFirstPage(page);
  });

  test.afterEach(async () => {
    await api.dispose();
  });

  test("creates a Project from the session picker, binds multiple workspaces, and assigns the selected workspace (#210)", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const fixture = await createWorkspaceFixture(testInfo, "picker-create-workspaces");
    const suffix = `${testInfo.workerIndex}-${Date.now()}`;
    const projectName = `e2e-210-picker-${suffix}`;
    const sessionTitle = `e2e-210-unassigned-${suffix}`;
    const sessionIds: string[] = [];
    const projectIds: string[] = [];

    try {
      const session = await createSession(api, {
        title: sessionTitle,
        projectId: null,
        workspacePath: null,
      });
      sessionIds.push(session.id);

      await loadChat(page);
      const projectDialog = await openSessionProjectPicker(page, sessionTitle);
      await expect(projectDialog.getByTestId("session-project-create")).toBeVisible();
      await expect(projectDialog.getByTestId("session-project-manage")).toBeVisible();

      await projectDialog.getByTestId("session-project-create").click();
      const manager = page.getByRole("dialog", { name: "Projects & workspaces" });
      await expect(manager).toBeVisible();
      await expect(manager.getByTestId("project-create-name")).toBeVisible();
      await manager.getByTestId("project-create-name").fill(projectName);
      await manager.getByTestId("project-create-path").getByRole("textbox").fill(fixture.primary);
      const createResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/api/v1/projects",
      );
      await manager.getByTestId("project-create-submit").click();
      const createResponse = await createResponsePromise;
      expect(createResponse.ok(), await createResponse.text()).toBe(true);
      const createdProject = (await createResponse.json()) as ProjectManifest;
      projectIds.push(createdProject.id);

      await manager.getByTestId("project-bind-input").getByRole("textbox").fill(fixture.secondary);
      const bindResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname ===
            `/api/v1/projects/${encodeURIComponent(createdProject.id)}/workspaces`,
      );
      await manager.getByTestId("project-bind-submit").click();
      const bindResponse = await bindResponsePromise;
      expect(bindResponse.ok(), await bindResponse.text()).toBe(true);
      const projectWithWorkspaces = (await bindResponse.json()) as ProjectManifest;
      expect(projectWithWorkspaces.workspace_bindings.map((binding) => binding.path)).toContain(
        fixture.secondary,
      );
      await closeDialog(manager);

      await expect(projectDialog).toBeVisible();
      await expect(projectDialog.locator(".ant-select-selection-item")).toHaveText(projectName);
      const secondaryWorkspace = projectDialog.getByTestId("session-project-workspace-1");
      await expect(secondaryWorkspace.locator("xpath=ancestor::label")).toContainText(
        fixture.secondary,
      );
      await secondaryWorkspace.click();

      const assignmentRequestPromise = page.waitForRequest(
        (request) =>
          request.method() === "PATCH" &&
          new URL(request.url()).pathname === `/api/v1/sessions/${encodeURIComponent(session.id)}`,
      );
      await projectDialog.getByRole("button", { name: "Assign" }).click();
      const assignmentRequest = await assignmentRequestPromise;
      expect(assignmentRequest.postDataJSON()).toEqual({
        project_id: createdProject.id,
        workspace_path: fixture.secondary,
      });
      await expect(projectDialog).toBeHidden();

      const persisted = await getSessionWithVersion(api, session.id);
      expect(persisted.session.project_id).toBe(createdProject.id);
      expect(persisted.session.workspace_path).toBe(fixture.secondary);
      await expectGroupExpanded(page, projectName, 1);
      await expect(sessionRow(page, sessionTitle).getByTestId("chat-item-workspace")).toHaveText(
        "secondary",
      );

      await page.reload();
      await expectGroupExpanded(page, projectName, 1);
      await expect(sessionRow(page, sessionTitle).getByTestId("chat-item-workspace")).toHaveText(
        "secondary",
      );
    } finally {
      await cleanupProjectFixture(api, fixture, sessionIds, projectIds);
    }
  });

  test("1/2/3: creates and renames a Project while session assignment and expansion stay keyed by project_id", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const fixture = await createWorkspaceFixture(testInfo, "lifecycle");
    const suffix = `${testInfo.workerIndex}-${Date.now()}`;
    const originalName = `e2e-158-lifecycle-${suffix}`;
    const renamedName = `${originalName}-renamed`;
    const targetName = `${originalName}-target`;
    const primaryTitle = `e2e-158-primary-${suffix}`;
    const secondaryTitle = `e2e-158-secondary-${suffix}`;
    const observerTitle = `e2e-158-observer-${suffix}`;
    const sessionIds: string[] = [];
    const projectIds: string[] = [];

    try {
      await loadChat(page);

      const manager = await openProjectManager(page);
      await manager.getByTestId("project-create-open").click();
      await manager.getByTestId("project-create-name").fill(originalName);
      await manager.getByTestId("project-create-path").getByRole("textbox").fill(fixture.primary);
      const createResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/api/v1/projects",
      );
      await manager.getByTestId("project-create-submit").click();
      const createResponse = await createResponsePromise;
      expect(createResponse.ok(), await createResponse.text()).toBe(true);
      let project = (await createResponse.json()) as ProjectManifest;
      expect(project.id).toBeTruthy();
      expect(project.project_path).toBe(fixture.primary);
      projectIds.push(project.id);

      await manager.getByTestId("project-bind-input").getByRole("textbox").fill(fixture.secondary);
      const bindResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname ===
            `/api/v1/projects/${encodeURIComponent(project.id)}/workspaces`,
      );
      await manager.getByTestId("project-bind-submit").click();
      const bindResponse = await bindResponsePromise;
      expect(bindResponse.ok(), await bindResponse.text()).toBe(true);
      project = (await bindResponse.json()) as ProjectManifest;
      expect(project.workspace_bindings.map((binding) => binding.path)).toContain(
        fixture.secondary,
      );
      await closeDialog(manager);

      const targetProject = await createProject(api, {
        name: targetName,
        projectPath: fixture.legacy,
      });
      projectIds.push(targetProject.id);

      const primarySession = await createSession(api, {
        title: primaryTitle,
        projectId: project.id,
        workspacePath: fixture.primary,
      });
      const secondarySession = await createSession(api, {
        title: secondaryTitle,
        projectId: project.id,
        workspacePath: fixture.secondary,
      });
      const observerSession = await createSession(api, {
        title: observerTitle,
        projectId: null,
        workspacePath: null,
      });
      sessionIds.push(primarySession.id, secondarySession.id, observerSession.id);

      await page.reload();
      await expectGroupExpanded(page, originalName, 2);
      await expect(sessionRow(page, primaryTitle)).toBeVisible();
      await expect(sessionRow(page, secondaryTitle)).toBeVisible();
      await expect(sessionRow(page, primaryTitle).getByTestId("chat-item-workspace")).toHaveText(
        "primary",
      );
      await expect(sessionRow(page, secondaryTitle).getByTestId("chat-item-workspace")).toHaveText(
        "secondary",
      );

      // Scenario 2: a session selects its owning Project, and that Project's
      // primary path becomes the execution directory in the same mutation.
      const projectDialog = await openSessionProjectPicker(page, primaryTitle);
      await selectSessionProject(page, projectDialog, targetName);
      await projectDialog.getByRole("button", { name: "Assign" }).click();
      await expect(projectDialog).toBeHidden();
      await expect(sessionRow(page, primaryTitle).getByTestId("chat-item-workspace")).toHaveText(
        "legacy",
      );
      const reassigned = await getSessionWithVersion(api, primarySession.id);
      expect(reassigned.session.project_id).toBe(targetProject.id);
      expect(reassigned.session.workspace_path).toBe(fixture.legacy);

      await page.reload();
      await expectGroupExpanded(page, originalName, 1);
      await expectGroupExpanded(page, targetName, 1);
      await expect(sessionRow(page, primaryTitle).getByTestId("chat-item-workspace")).toHaveText(
        "legacy",
      );

      // Select another group so the target Project is no longer force-expanded,
      // then persist its explicit expansion by opaque project_id.
      const unassignedGroup = page.getByRole("button", { name: /^Unassigned \(\d+\)$/ });
      await expect(unassignedGroup).toBeVisible();
      if ((await unassignedGroup.getAttribute("aria-expanded")) !== "true") {
        await unassignedGroup.click();
      }
      await sessionRow(page, observerTitle).click();
      await expect(page.locator('[data-testid="chat-input"]')).toBeVisible();
      const projectGroup = page.getByRole("button", { name: `${originalName} (1)` });
      if ((await projectGroup.getAttribute("aria-expanded")) !== "true") {
        await projectGroup.click();
      }
      await expect
        .poll(() =>
          page.evaluate(
            ({ key, projectId }) => {
              const value = JSON.parse(localStorage.getItem(key) || "[]");
              return Array.isArray(value) && value.includes(projectId);
            },
            { key: PROJECT_EXPANSION_STORAGE_KEY, projectId: project.id },
          ),
        )
        .toBe(true);
      await expect(unassignedGroup).toHaveAttribute("aria-expanded", "true");

      const renameManager = await openProjectManager(page);
      await renameManager.getByTestId(`project-list-item-${project.id}`).click();
      await renameManager.getByTestId("project-detail-name").fill(renamedName);
      const renameResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          new URL(response.url()).pathname === `/api/v1/projects/${encodeURIComponent(project.id)}`,
      );
      await renameManager.getByTestId("project-detail-save").click();
      const renameResponse = await renameResponsePromise;
      expect(renameResponse.ok(), await renameResponse.text()).toBe(true);
      await closeDialog(renameManager);

      await expect(page.getByRole("button", { name: `${renamedName} (1)` })).toBeVisible();
      await page.reload();
      const renamedGroup = page.getByRole("button", { name: `${renamedName} (1)` });
      await expect(renamedGroup).toHaveAttribute("aria-expanded", "true");
      await expect(sessionRow(page, secondaryTitle)).toBeVisible();
      await expect(page.getByRole("button", { name: `${originalName} (1)` })).toHaveCount(0);
      await expectGroupExpanded(page, targetName, 1);
      await expect(sessionRow(page, primaryTitle)).toBeVisible();
      expect(
        await page.evaluate(
          ({ key, projectId }) => {
            const value = JSON.parse(localStorage.getItem(key) || "[]");
            return Array.isArray(value) && value.includes(projectId);
          },
          { key: PROJECT_EXPANSION_STORAGE_KEY, projectId: project.id },
        ),
      ).toBe(true);
    } finally {
      await cleanupProjectFixture(api, fixture, sessionIds, projectIds);
    }
  });

  test("6: stale-revision conflicts preserve the server Project without silent overwrite", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const fixture = await createWorkspaceFixture(testInfo, "conflicts");
    const suffix = `${testInfo.workerIndex}-${Date.now()}`;
    const projectName = `e2e-158-source-${suffix}`;
    const targetName = `e2e-158-target-${suffix}`;
    const sessionTitle = `e2e-158-conflict-session-${suffix}`;
    const concurrentTitle = `${sessionTitle}-concurrent`;
    const sessionIds: string[] = [];
    const projectIds: string[] = [];

    try {
      const project = await createProject(api, {
        name: projectName,
        projectPath: fixture.primary,
      });
      const targetProject = await createProject(api, {
        name: targetName,
        projectPath: fixture.secondary,
      });
      projectIds.push(project.id, targetProject.id);
      const session = await createSession(api, {
        title: sessionTitle,
        projectId: project.id,
        workspacePath: fixture.primary,
      });
      sessionIds.push(session.id);

      await loadChat(page);
      await expectGroupExpanded(page, projectName, 1);

      // A controlled concurrent write advances Bamboo's real metadata revision
      // after Lotus' GET and before its PATCH. Only timing is intercepted; the
      // 412 and the retry data both come from Bamboo.
      let injectedRevisionConflict = false;
      const sessionPath = `/api/v1/sessions/${encodeURIComponent(session.id)}`;
      await page.route(`**${sessionPath}`, async (route) => {
        if (route.request().method() === "PATCH" && !injectedRevisionConflict) {
          injectedRevisionConflict = true;
          await patchSession(api, session.id, { title: concurrentTitle });
        }
        await route.continue();
      });

      const projectDialog = await openSessionProjectPicker(page, sessionTitle);
      await selectSessionProject(page, projectDialog, targetName);
      await projectDialog.getByRole("button", { name: "Assign" }).click();

      await expect.poll(() => injectedRevisionConflict).toBe(true);
      await expect(projectDialog).toContainText(
        "This session changed on the server. Its latest Project was restored; reopen the picker and try again.",
      );
      await expect(projectDialog.locator(".ant-select-selection-item")).toHaveText(targetName);
      await expect(sessionRow(page, concurrentTitle).getByTestId("chat-item-workspace")).toHaveText(
        "primary",
      );
      let persisted = await getSessionWithVersion(api, session.id);
      expect(persisted.session.project_id).toBe(project.id);
      expect(persisted.session.workspace_path).toBe(fixture.primary);

      await page.unroute(`**${sessionPath}`);
      await projectDialog.getByRole("button", { name: "Assign" }).click();
      await expect(projectDialog).toBeHidden();
      await expect(sessionRow(page, concurrentTitle).getByTestId("chat-item-workspace")).toHaveText(
        "secondary",
      );
      persisted = await getSessionWithVersion(api, session.id);
      expect(persisted.session.project_id).toBe(targetProject.id);
      expect(persisted.session.workspace_path).toBe(fixture.secondary);
    } finally {
      await cleanupProjectFixture(api, fixture, sessionIds, projectIds);
    }
  });

  test("4: a real SubAgent child and Schedule-this run inherit and display the parent Project", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const fixture = await createWorkspaceFixture(testInfo, "child-schedule");
    const suffix = `${testInfo.workerIndex}-${Date.now()}`;
    const projectName = `e2e-158-inheritance-${suffix}`;
    const parentTitle = `e2e-158-parent-${suffix}`;
    const childTitle = `e2e-158-child-${suffix}`;
    const scheduleName = `e2e-158-schedule-${suffix}`;
    const sessionIds: string[] = [];
    const projectIds: string[] = [];
    const scheduleIds: string[] = [];

    try {
      const project = await createProject(api, {
        name: projectName,
        projectPath: fixture.primary,
      });
      projectIds.push(project.id);
      const parent = await createSession(api, {
        title: parentTitle,
        projectId: project.id,
        workspacePath: fixture.primary,
      });
      sessionIds.push(parent.id);

      const permission = await allowSubAgentCreateForTest(api, suffix);
      let child: SessionSummary;
      try {
        child = await createChildDraft(api, parent.id, {
          title: childTitle,
          workspacePath: fixture.primary,
        });
      } finally {
        await permission.cleanup();
      }
      sessionIds.push(child.id);
      expect(child.kind).toBe("child");
      expect(child.parent_session_id).toBe(parent.id);
      expect(child.root_session_id).toBe(parent.id);
      expect(child.project_id).toBe(project.id);
      expect(child.workspace_path).toBe(fixture.primary);

      await loadChat(page);
      await expectGroupExpanded(page, projectName, 1);
      const parentRow = sessionRow(page, parentTitle);
      await expect(parentRow).toBeVisible();
      await parentRow.hover();
      await parentRow.getByRole("button", { name: "More actions" }).click();
      await page.getByText("Schedule this…", { exact: true }).click();

      const scheduleDialog = page.getByRole("dialog", { name: "Schedule this session" });
      await expect(scheduleDialog).toBeVisible();
      await scheduleDialog.getByLabel("Name").fill(scheduleName);
      const autoExecute = scheduleDialog.getByRole("switch", { name: "Auto execute" });
      await expect(autoExecute).toBeChecked();
      await autoExecute.click();
      await expect(autoExecute).not.toBeChecked();

      let scheduleRequestBody: Record<string, unknown> | null = null;
      const scheduleResponsePromise = page.waitForResponse((response) => {
        const matches =
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/api/v1/schedules";
        if (matches) {
          scheduleRequestBody = response.request().postDataJSON() as Record<string, unknown>;
        }
        return matches;
      });
      await scheduleDialog.getByRole("button", { name: "Create" }).click();
      const scheduleResponse = await scheduleResponsePromise;
      expect(scheduleResponse.ok(), await scheduleResponse.text()).toBe(true);
      const schedule = (await scheduleResponse.json()) as ScheduleEntry;
      scheduleIds.push(schedule.id);
      expect(scheduleRequestBody).not.toBeNull();
      expect(
        (scheduleRequestBody?.run_config as Record<string, unknown> | undefined)?.project_id,
      ).toBe(project.id);
      expect(schedule.run_config.project_id).toBe(project.id);
      expect(schedule.run_config.workspace_path).toBe(fixture.primary);
      expect(schedule.run_config.auto_execute).toBe(false);
      await expect(scheduleDialog).toBeHidden();

      await runScheduleNow(api, schedule.id);
      const scheduledSession = await waitForScheduleSession(api, schedule.id);
      sessionIds.push(scheduledSession.id);
      expect(scheduledSession.kind).toBe("root");
      expect(scheduledSession.created_by_schedule_id).toBe(schedule.id);
      expect(scheduledSession.project_id).toBe(project.id);
      expect(scheduledSession.workspace_path).toBe(fixture.primary);

      await page.reload();
      await expectGroupExpanded(page, projectName, 2);
      await expect(sessionRow(page, parentTitle)).toBeVisible();
      await expect(sessionRow(page, scheduleName)).toBeVisible();
      await page.getByTestId(`chat-item-children-toggle-${parent.id}`).click();
      await expect(sessionRow(page, childTitle)).toBeVisible();
      await expect(sessionRow(page, childTitle).getByTestId("chat-item-workspace")).toHaveText(
        "primary",
      );
    } finally {
      for (const scheduleId of scheduleIds.reverse()) {
        await deleteSchedule(api, scheduleId);
      }
      await cleanupProjectFixture(api, fixture, sessionIds, projectIds);
    }
  });

  test("5: legacy dry-run batches selected sessions, skips one, and retries one real 412", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const fixture = await createWorkspaceFixture(testInfo, "migration");
    const suffix = `${testInfo.workerIndex}-${Date.now()}`;
    const projectName = `e2e-158-migration-${suffix}`;
    const retryTitle = `e2e-158-migrate-retry-${suffix}`;
    const batchTitle = `e2e-158-migrate-batch-${suffix}`;
    const skippedTitle = `e2e-158-migrate-skip-${suffix}`;
    const concurrentTitle = `${retryTitle}-concurrent`;
    const sessionIds: string[] = [];
    const projectIds: string[] = [];

    try {
      // Create the sessions before the Project claims this path: this is the
      // real legacy shape that Bamboo's dry-run recognizes as exact matches.
      const retrySession = await createSession(api, {
        title: retryTitle,
        projectId: null,
        workspacePath: fixture.primary,
      });
      const batchSession = await createSession(api, {
        title: batchTitle,
        projectId: null,
        workspacePath: fixture.primary,
      });
      const skippedSession = await createSession(api, {
        title: skippedTitle,
        projectId: null,
        workspacePath: fixture.primary,
      });
      sessionIds.push(retrySession.id, batchSession.id, skippedSession.id);
      const project = await createProject(api, {
        name: projectName,
        projectPath: fixture.primary,
      });
      projectIds.push(project.id);

      await loadChat(page);
      const manager = await openProjectManager(page);
      const dryRunResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/api/v1/projects/migrations/legacy/dry-run",
      );
      await manager.getByTestId("open-legacy-migration").click();
      const dryRunResponse = await dryRunResponsePromise;
      expect(dryRunResponse.ok(), await dryRunResponse.text()).toBe(true);
      const dryRunRequest = dryRunResponse.request().postDataJSON() as {
        sessions?: Array<{ session_id: string; workspace_path?: string | null }>;
      };
      for (const sessionId of sessionIds) {
        expect(dryRunRequest.sessions).toContainEqual(
          expect.objectContaining({ session_id: sessionId, workspace_path: fixture.primary }),
        );
      }
      const retryDryRunInput = dryRunRequest.sessions?.find(
        (session) => session.session_id === retrySession.id,
      );
      expect(retryDryRunInput).toEqual({
        session_id: retrySession.id,
        workspace_path: fixture.primary,
      });
      expect(retryDryRunInput).not.toHaveProperty("canonical_path");
      expect(retryDryRunInput).not.toHaveProperty("git_common_dir");
      expect(retryDryRunInput).not.toHaveProperty("legacy_project_keys");
      const dryRunReport = (await dryRunResponse.json()) as {
        assignments: Array<{ session_id: string; project_id: string; basis: string }>;
      };
      for (const sessionId of sessionIds) {
        expect(dryRunReport.assignments).toContainEqual({
          session_id: sessionId,
          project_id: project.id,
          basis: "exact_canonical_binding",
        });
      }

      const migrationDialog = page.getByRole("dialog", { name: "Legacy session migration" });
      if (!(await migrationDialog.isVisible().catch(() => false))) {
        const showDetails = page.getByRole("button", { name: "Show Details" });
        if (await showDetails.isVisible().catch(() => false)) {
          await showDetails.click();
        }
        throw new Error(`Legacy migration UI crashed:\n${await page.locator("body").innerText()}`);
      }
      await expect(migrationDialog.getByRole("checkbox", { name: retryTitle })).toBeChecked();
      await expect(migrationDialog.getByRole("checkbox", { name: batchTitle })).toBeChecked();
      await migrationDialog.getByRole("checkbox", { name: skippedTitle }).uncheck();

      // The shared backend may contain unrelated legacy fixtures. Select only
      // this test's two sessions so the suite never mutates another owner.
      const assignmentRows = migrationDialog.locator(".ant-checkbox-wrapper");
      for (let index = (await assignmentRows.count()) - 1; index >= 0; index -= 1) {
        const row = assignmentRows.nth(index);
        const text = (await row.textContent()) || "";
        const checkbox = row.getByRole("checkbox");
        if (
          (await checkbox.isChecked().catch(() => false)) &&
          !text.includes(retryTitle) &&
          !text.includes(batchTitle)
        ) {
          await checkbox.uncheck();
        }
      }
      await expect(migrationDialog.getByTestId("migration-apply")).toHaveText(
        "Assign selected (2)",
      );

      // Inject a concurrent real metadata write after Lotus' first GET. Bamboo
      // returns the 412; the migration UI must GET again and retry once.
      const retryPath = `/api/v1/sessions/${encodeURIComponent(retrySession.id)}`;
      let retryPatchCount = 0;
      await page.route(`**${retryPath}`, async (route) => {
        if (route.request().method() === "PATCH") {
          retryPatchCount += 1;
          if (retryPatchCount === 1) {
            await patchSession(api, retrySession.id, { title: concurrentTitle });
          }
        }
        await route.continue();
      });

      await migrationDialog.getByTestId("migration-apply").click();
      await expect(migrationDialog).toContainText("Migration finished: 2 assigned, 0 failed");
      expect(retryPatchCount).toBe(2);
      await page.unroute(`**${retryPath}`);

      expect((await getSessionWithVersion(api, retrySession.id)).session.project_id).toBe(
        project.id,
      );
      expect((await getSessionWithVersion(api, batchSession.id)).session.project_id).toBe(
        project.id,
      );
      expect((await getSessionWithVersion(api, skippedSession.id)).session.project_id).toBeNull();

      await migrationDialog.getByRole("button", { name: "Close", exact: true }).last().click();
      await closeDialog(manager);
      await page.reload();
      await expectGroupExpanded(page, projectName, 2);
      await expect(sessionRow(page, concurrentTitle)).toBeVisible();
      await expect(sessionRow(page, batchTitle)).toBeVisible();
      const unassignedGroup = page.getByRole("button", { name: /^Unassigned \(\d+\)$/ });
      if ((await unassignedGroup.getAttribute("aria-expanded")) !== "true") {
        await unassignedGroup.click();
      }
      await expect(sessionRow(page, skippedTitle)).toBeVisible();
    } finally {
      await cleanupProjectFixture(api, fixture, sessionIds, projectIds);
    }
  });

  test("7: a real Project resource watcher update refreshes manager state and prompt inspector revision", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const fixture = await createWorkspaceFixture(testInfo, "resources");
    const suffix = `${testInfo.workerIndex}-${Date.now()}`;
    const projectName = `e2e-158-resources-${suffix}`;
    const sessionTitle = `e2e-158-resource-session-${suffix}`;
    const sessionIds: string[] = [];
    const projectIds: string[] = [];
    let resourceCleanup: (() => Promise<void>) | null = null;

    try {
      const project = await createProject(api, {
        name: projectName,
        projectPath: fixture.primary,
      });
      projectIds.push(project.id);
      const session = await createSession(api, {
        title: sessionTitle,
        projectId: project.id,
        workspacePath: fixture.primary,
        systemPrompt: "Inspect Bamboo's Project and workspace context.",
      });
      sessionIds.push(session.id);

      await loadChat(page);
      await expectGroupExpanded(page, projectName, 1);
      await sessionRow(page, sessionTitle).click();
      const enhancedButton = page.getByRole("button", { name: /View Enhanced/ });
      await expect(enhancedButton).toBeVisible();
      await enhancedButton.click();
      const promptDetails = page.getByTestId("prompt-context-details");
      await expect(promptDetails).toBeVisible();
      await expect(page.getByTestId("prompt-project-path")).toHaveText(fixture.primary);
      await expect(page.getByTestId("prompt-session-workspace")).toHaveText(fixture.primary);
      await expect(page.getByTestId("prompt-effective-workspace")).toHaveText(fixture.primary);
      await expect(page.getByTestId("prompt-resource-revision")).toHaveText(
        String(project.resource_revision),
      );

      const resourceFixture = await writeProjectCommandResource(project.id, suffix);
      resourceCleanup = resourceFixture.cleanup;
      let refreshedProject = project;
      await expect
        .poll(
          async () => {
            refreshedProject = await getProject(api, project.id);
            return refreshedProject.resource_revision;
          },
          { timeout: 20_000 },
        )
        .toBeGreaterThan(project.resource_revision);

      // The account feed advances ProjectStore; the open prompt inspector then
      // refreshes its resource summary and displays that same authoritative rev.
      await expect(page.getByTestId("prompt-resource-revision")).toHaveText(
        String(refreshedProject.resource_revision),
        { timeout: 20_000 },
      );

      const manager = await openProjectManager(page);
      await manager.getByTestId(`project-list-item-${project.id}`).click();
      await expect(manager.getByText(/^commands \(\d+\)$/)).toBeVisible();
      await expect(
        manager.getByText(`Resource revision: ${refreshedProject.resource_revision}`),
      ).toBeVisible();
      await closeDialog(manager);
    } finally {
      if (resourceCleanup) {
        await resourceCleanup();
      }
      await cleanupProjectFixture(api, fixture, sessionIds, projectIds);
    }
  });

  test("8: archive/restore retains sessions and Missing project metadata degrades explicitly", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const fixture = await createWorkspaceFixture(testInfo, "archive-missing");
    const suffix = `${testInfo.workerIndex}-${Date.now()}`;
    const projectName = `e2e-158-archive-${suffix}`;
    const sessionTitle = `e2e-158-archive-session-${suffix}`;
    const missingTitle = `e2e-158-missing-session-${suffix}`;
    const missingProjectId = `e2e-158-missing-project-${suffix}`;
    const missingSessionId = `e2e-158-missing-${suffix}`;
    const sessionIds: string[] = [];
    const projectIds: string[] = [];

    try {
      const project = await createProject(api, {
        name: projectName,
        projectPath: fixture.primary,
      });
      projectIds.push(project.id);
      const session = await createSession(api, {
        title: sessionTitle,
        projectId: project.id,
        workspacePath: fixture.primary,
      });
      sessionIds.push(session.id);

      const now = new Date().toISOString();
      const missingSession: SessionSummary = {
        id: missingSessionId,
        kind: "root",
        title: missingTitle,
        title_version: 1,
        pinned: false,
        parent_session_id: null,
        root_session_id: missingSessionId,
        spawn_depth: 0,
        model: "e2e-model",
        model_ref: null,
        project_id: missingProjectId,
        workspace_path: fixture.legacy,
        created_at: now,
        updated_at: now,
        last_activity_at: now,
        message_count: 0,
        has_attachments: false,
        is_running: false,
        metadata_version: 1,
      };

      // A missing/invisible Project cannot be manufactured through the real
      // API, so this boundary injects only the unavailable Project reference.
      // Session detail/history stay readable to exercise Lotus' degradation UI.
      await page.route("**/api/v1/sessions**", async (route) => {
        const pathname = new URL(route.request().url()).pathname;
        if (route.request().method() !== "GET") {
          await route.continue();
          return;
        }
        if (pathname === `/api/v1/sessions/${encodeURIComponent(missingSessionId)}`) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: {
              ETag: '"1"',
              "Access-Control-Expose-Headers": "ETag",
            },
            body: JSON.stringify({ session: missingSession }),
          });
          return;
        }
        if (pathname === "/api/v1/sessions") {
          const response = await route.fetch();
          const body = (await response.json()) as { sessions: SessionSummary[] };
          await route.fulfill({
            response,
            json: { ...body, sessions: [...body.sessions, missingSession] },
          });
          return;
        }
        await route.continue();
      });
      await page.route(
        `**/api/v1/history/${encodeURIComponent(missingSessionId)}`,
        async (route) => {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ session_id: missingSessionId, messages: [] }),
          });
        },
      );

      await loadChat(page);
      await expectGroupExpanded(page, projectName, 1);
      const missingGroup = await expectGroupExpanded(page, "Missing project", 1);
      await expect(missingGroup).not.toContainText("legacy");
      await expect(sessionRow(page, missingTitle)).toBeVisible();
      await sessionRow(page, missingTitle).click();
      await expect(page.locator('[data-testid="chat-input"]')).toBeVisible();
      await expect(sessionRow(page, missingTitle).getByTestId("chat-item-workspace")).toHaveText(
        "legacy",
      );

      const manager = await openProjectManager(page);
      await manager.getByTestId(`project-list-item-${project.id}`).click();
      await manager.getByTestId("project-archive").click();
      const archiveConfirmation = page.locator(".ant-popconfirm");
      await expect(archiveConfirmation).toBeVisible();
      await archiveConfirmation.getByRole("button", { name: "Archive" }).click();
      await expect(page.getByText("Project archived")).toBeVisible();
      await expect(manager.getByTestId("project-unarchive")).toBeVisible();
      const archivedGroup = page.getByRole("button", { name: `${projectName} (1)` });
      await expect(archivedGroup).toContainText("Archived");
      await expect(sessionRow(page, sessionTitle)).toBeVisible();

      await manager.getByTestId("project-unarchive").click();
      await expect(page.getByText("Project restored")).toBeVisible();
      await expect(manager.getByTestId("project-archive")).toBeVisible();
      await expect(archivedGroup).not.toContainText("Archived");
      await closeDialog(manager);

      await page.reload();
      await expect(page.getByRole("button", { name: `${projectName} (1)` })).not.toContainText(
        "Archived",
      );
      await expectGroupExpanded(page, "Missing project", 1);
      await expect(sessionRow(page, missingTitle)).toBeVisible();
    } finally {
      await cleanupProjectFixture(api, fixture, sessionIds, projectIds);
    }
  });

  test("9: Project and Unassigned group actions create, select, and enable bypass atomically (#198)", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const fixture = await createWorkspaceFixture(testInfo, "group-create");
    const suffix = `${testInfo.workerIndex}-${Date.now()}`;
    const projectName = `e2e-198-create-${suffix}`;
    const projectSeedTitle = `e2e-198-project-seed-${suffix}`;
    const unassignedSeedTitle = `e2e-198-unassigned-seed-${suffix}`;
    const sessionIds: string[] = [];
    const projectIds: string[] = [];

    try {
      const project = await createProject(api, {
        name: projectName,
        projectPath: fixture.primary,
      });
      projectIds.push(project.id);
      const projectSeed = await createSession(api, {
        title: projectSeedTitle,
        projectId: project.id,
        workspacePath: fixture.primary,
      });
      const unassignedSeed = await createSession(api, {
        title: unassignedSeedTitle,
        projectId: null,
        workspacePath: fixture.legacy,
      });
      sessionIds.push(projectSeed.id, unassignedSeed.id);

      await loadChat(page);

      const createFromGroup = async (input: {
        groupName: string;
        seedTitle: string;
        initialCount: number | "live";
        projectId: string | null;
        workspacePath: string | null;
      }) => {
        // The browser suite shares one Bamboo process, so unrelated tests may
        // leave additional Unassigned sessions. Only that group reads its live
        // total; a uniquely created Project must still begin with one seed.
        const { group, count: initialCount } =
          input.initialCount === "live"
            ? await findGroupWithCount(page, input.groupName)
            : {
                group: page.getByRole("button", {
                  name: exactGroupName(input.groupName, input.initialCount),
                }),
                count: input.initialCount,
              };
        await expect(group).toHaveCount(1);
        await expect(group).toBeVisible();
        if ((await group.getAttribute("aria-expanded")) !== "true") {
          await group.click();
        }
        const seedRow = group
          .locator("..")
          .getByRole("option", { name: input.seedTitle, exact: true });
        await expect(seedRow).toHaveCount(1);
        await expect(seedRow).toBeVisible();
        await group.hover();
        const createButton = group.getByRole("button", {
          name: "Create session in this project",
        });
        await expect(createButton).toHaveCSS("opacity", "1");

        const createResponsePromise = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            new URL(response.url()).pathname === "/api/v1/sessions",
        );
        const sessionResponses: PlaywrightResponse[] = [];
        const bypassResponses: PlaywrightResponse[] = [];
        const bypassResponsePromise = page.waitForResponse((response) => {
          const path = new URL(response.url()).pathname;
          if (!path.startsWith("/api/v1/sessions/")) {
            return false;
          }

          sessionResponses.push(response);
          if (response.request().method() !== "PATCH") {
            return false;
          }

          bypassResponses.push(response);
          // Typed writes use optimistic CAS. A create-time metadata update may
          // win the first race, so wait for the bounded retry after one 412.
          // Every captured attempt is validated below, including failures.
          return response.status() !== 412 || bypassResponses.length === 2;
        });

        await createButton.click();
        const createResponse = await createResponsePromise;
        expect(createResponse.ok(), await createResponse.text()).toBe(true);
        const requestBody = createResponse.request().postDataJSON() as {
          project_id?: string | null;
          workspace_path?: string | null;
        };
        expect(requestBody.project_id).toBe(input.projectId);
        expect(requestBody.workspace_path).toBe(input.workspacePath);
        const createBody = (await createResponse.json()) as {
          session: SessionSummary;
        };
        sessionIds.push(createBody.session.id);
        expect(createBody.session.project_id).toBe(input.projectId);
        if (input.workspacePath !== null) {
          expect(createBody.session.workspace_path).toBe(input.workspacePath);
        } else {
          // A null request leaves workspace selection to Bamboo. It may assign
          // an isolated session workspace, but must not inherit the Project's.
          expect(createBody.session.workspace_path).not.toBe(fixture.primary);
        }

        const bypassResponse = await bypassResponsePromise;
        expect(bypassResponse.ok(), await bypassResponse.text()).toBe(true);
        const sessionPath = `/api/v1/sessions/${encodeURIComponent(createBody.session.id)}`;
        const supportsTypedMode = createBody.session.permission_mode !== undefined;

        if (supportsTypedMode) {
          expect([1, 2]).toContain(bypassResponses.length);
        } else {
          expect(bypassResponses).toHaveLength(1);
        }

        for (const attempt of bypassResponses) {
          expect(new URL(attempt.url()).pathname).toBe(sessionPath);
          if (supportsTypedMode) {
            expect(attempt.request().postDataJSON()).toEqual({
              permission_mode: "bypass",
            });
            const ifMatch = attempt.request().headers()["if-match"];
            expect(ifMatch).toMatch(/^"\d+"$/);

            const attemptIndex = sessionResponses.indexOf(attempt);
            const precedingRead = sessionResponses
              .slice(0, attemptIndex)
              .reverse()
              .find(
                (candidate) =>
                  candidate.request().method() === "GET" &&
                  new URL(candidate.url()).pathname === sessionPath &&
                  candidate.ok(),
              );
            expect(precedingRead).toBeDefined();
            expect(ifMatch).toBe(precedingRead?.headers()["etag"]?.replace(/^W\//, ""));
          } else {
            expect(attempt.request().postDataJSON()).toEqual({
              bypass_permissions: true,
            });
          }
        }

        if (bypassResponses.length === 2) {
          expect(bypassResponses[0].status()).toBe(412);
          expect(bypassResponses[1].ok()).toBe(true);
          const firstAttemptIndex = sessionResponses.indexOf(bypassResponses[0]);
          const secondAttemptIndex = sessionResponses.indexOf(bypassResponses[1]);
          expect(
            sessionResponses
              .slice(firstAttemptIndex + 1, secondAttemptIndex)
              .some(
                (response) =>
                  response.request().method() === "GET" &&
                  new URL(response.url()).pathname === sessionPath &&
                  response.ok(),
              ),
          ).toBe(true);
        }

        await expect(
          page.getByRole("button", {
            name: exactGroupName(input.groupName, initialCount + 1),
          }),
        ).toBeVisible();
        await expect(
          page.getByRole("option", {
            name: "New Session",
            selected: true,
          }),
        ).toBeVisible();
        await expect(
          page.locator(".chat-pane-shell__title").getByText("New Session"),
        ).toBeVisible();
        await expect(page.locator('[data-testid="chat-input"]')).toBeVisible();
        const permissionModeControl = page.getByTestId("permission-mode-control");
        await expect(permissionModeControl).toHaveAttribute("data-permission-mode", "bypass");
        await expect(permissionModeControl).toContainText("Bypass");

        const persisted = await getSessionWithVersion(api, createBody.session.id);
        expect(persisted.session.project_id).toBe(input.projectId);
        expect(persisted.session.workspace_path).toBe(createBody.session.workspace_path);
        if (input.workspacePath !== null) {
          expect(persisted.session.workspace_path).toBe(input.workspacePath);
        }
        expect(persisted.session.bypass_permissions).toBe(true);
        if (createBody.session.permission_mode !== undefined) {
          expect(persisted.session.permission_mode).toBe("bypass");
        }
      };

      await createFromGroup({
        groupName: projectName,
        seedTitle: projectSeedTitle,
        initialCount: 1,
        projectId: project.id,
        workspacePath: fixture.primary,
      });
      await createFromGroup({
        groupName: "Unassigned",
        seedTitle: unassignedSeedTitle,
        initialCount: "live",
        projectId: null,
        workspacePath: null,
      });
    } finally {
      await cleanupProjectFixture(api, fixture, sessionIds, projectIds);
    }
  });
});
