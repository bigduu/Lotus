import { expect, test } from "@playwright/test";

test.describe("Session Project picker and lifecycle (#208 / #725)", () => {
  test("persists an atomic Project assignment and restores an archived Project", async ({
    page,
  }) => {
    const sessionId = "session-project-workspace";
    const projectId = "proj-zenith";
    const targetProjectId = "proj-bamboo";
    const archivedSessionId = "session-archived-project";
    const archivedProjectId = "proj-old";
    const primaryPath = "/repo/zenith";
    const worktreePath = "/repo/zenith-worktree";
    const targetPath = "/repo/bamboo";
    const now = "2026-07-28T00:00:00Z";
    let persistedProjectId = projectId;
    let persistedWorkspacePath = primaryPath;
    let metadataVersion = 7;
    let patchCallCount = 0;
    let patchBody: Record<string, unknown> | null = null;
    let patchIfMatch: string | null = null;
    let archivedStatus: "active" | "archived" = "archived";
    let archivedRevision = 4;
    let unarchiveCallCount = 0;
    let unarchiveBody: Record<string, unknown> | null = null;
    let unarchiveIfMatch: string | null = null;

    await page.addInitScript(() => {
      localStorage.setItem("bodhi_onboarding_complete", "true");
    });

    const session = () => ({
      id: sessionId,
      kind: "root",
      title: "Project workspace switch",
      title_version: 1,
      pinned: false,
      parent_session_id: null,
      root_session_id: sessionId,
      spawn_depth: 0,
      model: "gpt-4o",
      model_ref: { provider: "openai", model: "gpt-4o" },
      project_id: persistedProjectId,
      workspace_path: persistedWorkspacePath,
      created_at: now,
      updated_at: now,
      last_activity_at: now,
      message_count: 0,
      has_attachments: false,
      is_running: false,
    });

    const archivedSession = () => ({
      ...session(),
      id: archivedSessionId,
      title: "Archived Project session",
      project_id: archivedProjectId,
      workspace_path: "/repo/old",
    });

    const project = {
      id: projectId,
      name: "Zenith",
      description: null,
      status: "active",
      revision: 3,
      resource_revision: 1,
      project_path: primaryPath,
      project_path_status: "configured",
      workspace_count: 2,
      created_at: now,
      updated_at: now,
      schema_version: 1,
      workspace_bindings: [
        {
          path: worktreePath,
          label: "Issue 155 worktree",
          git_common_dir: "/repo/zenith/.git",
        },
      ],
    };

    const targetProject = {
      ...project,
      id: targetProjectId,
      name: "Bamboo",
      project_path: targetPath,
      workspace_count: 1,
      workspace_bindings: [],
    };

    const archivedProject = () => ({
      ...project,
      id: archivedProjectId,
      name: "Old Project",
      status: archivedStatus,
      revision: archivedRevision,
      project_path: "/repo/old",
      workspace_count: 1,
      workspace_bindings: [],
    });

    await page.route("**/api/v1/health", async (route) => {
      await route.fulfill({ status: 200, contentType: "text/plain", body: "OK" });
    });

    await page.route("**/v1/bamboo/config/provider-settings", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            provider: "openai",
            providers: { openai: { model: "gpt-4o" } },
            defaults: { chat: { provider: "openai", model: "gpt-4o" } },
            features: { provider_model_ref: true },
            provider_instances: {},
            default_provider_instance_id: null,
            available_providers: ["openai"],
            credential_status: {
              providers: {
                openai: {
                  credential_ref: "provider.openai.api_key",
                  configured: true,
                  source: "user",
                  updated_at: null,
                },
              },
              provider_instances: {},
            },
          },
          revision: 1,
          loaded_at: now,
          source_path: "/tmp/providers.json",
          source_kind: "file",
          status: "healthy",
          last_error: null,
        }),
      });
    });

    await page.route("**/v1/projects**", async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (
        request.method() === "POST" &&
        pathname.endsWith(`/projects/${archivedProjectId}/unarchive`)
      ) {
        unarchiveCallCount += 1;
        unarchiveBody = request.postDataJSON() as Record<string, unknown>;
        unarchiveIfMatch = request.headers()["if-match"] ?? null;
        archivedStatus = "active";
        archivedRevision += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: {
            ETag: `"${archivedRevision}"`,
            "Access-Control-Expose-Headers": "ETag",
          },
          body: JSON.stringify(archivedProject()),
        });
        return;
      }
      if (pathname.endsWith("/resources")) {
        const resourceProjectId = pathname.includes(archivedProjectId)
          ? archivedProjectId
          : projectId;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            project_id: resourceProjectId,
            resource_revision: 1,
            resources: [],
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          pathname.endsWith(`/projects/${projectId}`)
            ? project
            : pathname.endsWith(`/projects/${targetProjectId}`)
              ? targetProject
              : pathname.endsWith(`/projects/${archivedProjectId}`)
                ? archivedProject()
                : { projects: [project, targetProject, archivedProject()] },
        ),
      });
    });

    await page.route("**/api/v1/sessions**", async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const isDetail = pathname.endsWith(`/sessions/${sessionId}`);

      if (request.method() === "PATCH" && isDetail) {
        const body = request.postDataJSON() as Record<string, unknown>;
        if (Object.prototype.hasOwnProperty.call(body, "project_id")) {
          patchCallCount += 1;
          patchBody = body;
          patchIfMatch = request.headers()["if-match"] ?? null;
          persistedProjectId = String(body.project_id ?? "");
          persistedWorkspacePath = String(body.workspace_path ?? "");
          metadataVersion += 1;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: {
            ETag: `"${metadataVersion}"`,
            "Access-Control-Expose-Headers": "ETag",
          },
          body: JSON.stringify({ session: session() }),
        });
        return;
      }

      if (request.method() === "GET" && isDetail) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: {
            ETag: `"${metadataVersion}"`,
            "Access-Control-Expose-Headers": "ETag",
          },
          body: JSON.stringify({ session: session() }),
        });
        return;
      }

      if (request.method() === "GET" && pathname.endsWith("/sessions")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ sessions: [session(), archivedSession()] }),
        });
        return;
      }

      await route.continue();
    });

    await page.route(`**/api/v1/history/${sessionId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ session_id: sessionId, messages: [] }),
      });
    });

    await page.route("**/v1/workspace/**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.endsWith("/workspace/files")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([]),
        });
        return;
      }
      if (pathname.endsWith("/workspace/validate")) {
        const body = route.request().postDataJSON() as { path?: string };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ path: body.path ?? "", is_valid: true }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto("/chat");
    await expect(page.locator('[data-testid="chat-item"]').first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Zenith (1)" })).toBeVisible();
    const archivedGroup = page.getByRole("button", { name: "Old Project (1)" });
    await expect(archivedGroup).toContainText("Archived");
    await page.locator('[data-testid="chat-item"]').first().click();
    await expect(page.locator('[data-testid="chat-input"]')).toBeVisible();

    await page.getByRole("button", { name: "Reference workspace files" }).click();
    await expect(page.getByRole("button", { name: "Set Project" })).toBeVisible();
    await page.getByRole("button", { name: "Set Project" }).click();
    const projectDialog = page.getByRole("dialog", { name: "Assign session to Project" });
    await expect(projectDialog).toBeVisible();
    await projectDialog.getByTestId("session-project-select").click();
    await page.locator(".ant-select-item-option").filter({ hasText: "Bamboo" }).click();
    await projectDialog.getByRole("button", { name: "Assign" }).click();
    await expect(projectDialog).toBeHidden();

    await expect.poll(() => patchCallCount).toBe(1);
    expect(patchBody).toEqual({ project_id: targetProjectId, workspace_path: targetPath });
    expect(patchIfMatch).toBe('"7"');
    await expect(page.getByTestId("chat-item-workspace")).toHaveText("bamboo");
    await expect(page.getByRole("button", { name: "Bamboo (1)" })).toBeVisible();

    await page.reload();
    await expect(page.locator('[data-testid="chat-item"]').first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Bamboo (1)" })).toBeVisible();
    await expect(page.getByTestId("chat-item-workspace")).toHaveText("bamboo");
    await page.locator('[data-testid="chat-item"]').first().click();
    await page.getByRole("button", { name: "Reference workspace files" }).click();
    await page.getByRole("button", { name: "Set Project" }).click();
    const restoredDialog = page.getByRole("dialog", { name: "Assign session to Project" });
    await expect(restoredDialog.locator(".ant-select-selection-item")).toHaveText("Bamboo");
    await restoredDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(restoredDialog).toBeHidden();

    await page.getByTestId("open-project-manager").click();
    await expect(page.getByTestId("project-archived-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await page.getByTestId("project-archived-toggle").click();
    await page.getByTestId(`project-list-item-${archivedProjectId}`).click();
    await page.getByTestId("project-unarchive").click();

    await expect.poll(() => unarchiveCallCount).toBe(1);
    expect(unarchiveBody).toEqual({});
    expect(unarchiveIfMatch).toBe('"4"');
    await expect(page.getByText("Project restored")).toBeVisible();
    await expect(page.getByTestId("project-unarchive")).toHaveCount(0);
    await expect(page.getByTestId("project-archive")).toBeVisible();
    await expect(page.getByTestId("project-archived-toggle")).toHaveCount(0);

    // Restore changes only Project status. Its existing session stays under
    // the same opaque Project group, while the archived badge disappears.
    await expect(archivedGroup).toBeVisible();
    await expect(archivedGroup).not.toContainText("Archived");
    await expect(page.getByRole("button", { name: "Bamboo (1)" })).toBeVisible();
  });
});
