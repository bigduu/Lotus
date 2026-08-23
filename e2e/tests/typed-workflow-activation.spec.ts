import path from "node:path";

import { expect, test } from "@playwright/test";

test.describe("Typed instruction Workflow activation (#231)", () => {
  test("preserves a rejected draft, sends metadata only, and restores the public receipt", async ({
    page,
  }, testInfo) => {
    const sessionId = "session-typed-workflow";
    const now = "2026-08-23T08:00:00Z";
    let catalogRevision = 12;
    let chatAttempt = 0;
    let activeWorkflow = false;
    const chatRequests: Array<Record<string, unknown>> = [];

    await page.addInitScript(() => {
      localStorage.setItem("bodhi_onboarding_complete", "true");
    });
    await page.setViewportSize({ width: 1440, height: 960 });

    await page.routeWebSocket("**/v2/stream", (socket) => {
      socket.onMessage((message) => {
        if (typeof message !== "string") return;
        const frame = JSON.parse(message) as { type?: string };
        if (frame.type === "ping") {
          socket.send(JSON.stringify({ type: "pong" }));
        }
      });
    });

    const sessionSummary = () => ({
      id: sessionId,
      kind: "root",
      title: "Typed Workflow acceptance",
      title_version: 1,
      title_generated: false,
      pinned: false,
      parent_session_id: null,
      root_session_id: sessionId,
      spawn_depth: 0,
      model: "gpt-5",
      model_ref: { provider: "openai", model: "gpt-5" },
      provider: "openai",
      created_at: now,
      updated_at: now,
      last_activity_at: now,
      message_count: 0,
      has_attachments: false,
      is_running: false,
      has_pending_question: false,
      running_child_count: 0,
      bypass_permissions: false,
      permission_mode: "default",
      placement: { kind: "local", host: "e2e.local" },
    });

    const workflowCatalog = () => ({
      revision: catalogRevision,
      entries: [
        {
          id: "review",
          name: "Review safely",
          description: "Review the selected scope without exposing expanded instructions.",
          kind: "instruction",
          source: "project",
          revision: catalogRevision,
          version: String(catalogRevision),
          invocation_policy: { explicit: true, automatic: false },
          argument_hint: "<scope> [strict]",
          argument_schema: {
            type: "object",
            properties: {
              scope: { type: "string", default: "src" },
              strict: { type: "boolean", default: false },
            },
            required: ["scope"],
            additionalProperties: false,
          },
          status: "valid",
          winner: true,
        },
      ],
    });

    await page.route("**/api/v1/**", async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;

      if (pathname === "/api/v1/health") {
        await route.fulfill({ status: 200, contentType: "text/plain", body: "OK" });
        return;
      }
      if (pathname === "/api/v1/sessions" && request.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ sessions: [sessionSummary()] }),
        });
        return;
      }
      if (pathname === `/api/v1/sessions/${sessionId}` && request.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            session: {
              ...sessionSummary(),
              ...(activeWorkflow
                ? {
                    active_workflow: {
                      id: "review",
                      name: "Review safely",
                      source: "project",
                      revision: catalogRevision,
                      version: String(catalogRevision),
                      kind: "instruction",
                      invoked_by: "user",
                      activated_at: now,
                      status: "active",
                      args: { must_not_reach_lotus_state: "PRIVATE" },
                      dynamic_context: "PRIVATE PROVIDER OUTPUT",
                      resources: ["/private/workflow/resource.md"],
                    },
                  }
                : {}),
            },
          }),
        });
        return;
      }
      if (pathname === `/api/v1/history/${sessionId}` && request.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ session_id: sessionId, messages: [] }),
        });
        return;
      }
      if (pathname === "/api/v1/runs/active") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ sessions: [] }),
        });
        return;
      }
      if (pathname === "/api/v1/subagents/snapshot") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            schema_version: 1,
            snapshot_seq: 0,
            approvals_revision: 0,
            generated_at: now,
            approvals: [],
            children: [],
          }),
        });
        return;
      }
      if (pathname === "/api/v1/chat" && request.method() === "POST") {
        chatAttempt += 1;
        chatRequests.push(request.postDataJSON() as Record<string, unknown>);
        if (chatAttempt === 1) {
          await route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({
              error: {
                type: "api_error",
                code: "workflow_revision_mismatch",
                message: "The selected Workflow changed. Refresh and reselect it.",
                recoverable: true,
              },
            }),
          });
          return;
        }

        activeWorkflow = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ session_id: sessionId, status: "started" }),
        });
        return;
      }
      if (pathname === `/api/v1/execute/${sessionId}` && request.method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            session_id: sessionId,
            status: "completed",
            events_url: `/api/v1/events/${sessionId}`,
          }),
        });
        return;
      }
      if (pathname === `/api/v1/events/${sessionId}`) {
        await route.fulfill({ status: 204, body: "" });
        return;
      }
      if (pathname.includes("/events")) {
        await route.fulfill({ status: 204, body: "" });
        return;
      }
      if (pathname === `/api/v1/respond/${sessionId}/pending`) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ has_pending_question: false }),
        });
        return;
      }
      if (pathname === "/api/v1/ledger/agenda") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            generated_at: now,
            overdue: [],
            today: [],
            upcoming: [],
            undated: [],
          }),
        });
        return;
      }
      if (pathname === "/api/v1/ledger/records") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ records: [], total: 0 }),
        });
        return;
      }

      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await page.route("**/v1/**", async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;

      // `/api/v1/*` also matches this broad suffix pattern. Let the earlier
      // agent-route handler own it instead of returning a standard-API shape.
      if (pathname.startsWith("/api/v1/")) {
        await route.fallback();
        return;
      }

      if (pathname === "/v1/bamboo/config/provider-settings") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              provider: "openai",
              providers: {},
              defaults: { chat: { provider: "openai", model: "gpt-5" } },
              features: { provider_model_ref: true },
              provider_instances: {
                openai: {
                  provider_type: "openai",
                  label: "OpenAI",
                  enabled: true,
                  base_url: null,
                  model: "gpt-5",
                  fast_model: null,
                  vision_model: null,
                  reasoning_effort: null,
                  responses_only_models: [],
                  request_overrides: null,
                },
              },
              default_provider_instance_id: "openai",
              available_providers: ["openai"],
              credential_status: {
                providers: {},
                provider_instances: {
                  openai: {
                    credential_ref: "provider_instances.openai.api_key",
                    configured: true,
                    source: "user",
                    updated_at: null,
                  },
                },
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
        return;
      }
      if (pathname === "/v1/bamboo/provider-catalog/fetch-models") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            fetched: [
              {
                provider: "openai",
                models: [
                  {
                    reference: { provider: "openai", model: "gpt-5" },
                    display_name: "GPT-5",
                    provider_display_name: "OpenAI",
                    capabilities: {
                      supports_tools: true,
                      supports_vision: true,
                      supports_reasoning: true,
                      supports_streaming: true,
                    },
                    source: "static",
                  },
                ],
              },
            ],
          }),
        });
        return;
      }
      if (pathname === "/v1/commands") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ commands: [] }),
        });
        return;
      }
      if (pathname === "/v1/bamboo/workflow-catalog") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(workflowCatalog()),
        });
        return;
      }
      if (pathname === "/v1/bamboo/setup/status") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ is_complete: true }),
        });
        return;
      }
      if (pathname === "/v1/projects") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ projects: [] }),
        });
        return;
      }

      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await page.goto("/chat");
    const sessionRow = page.locator(`[data-session-id="${sessionId}"]`);
    if (await sessionRow.isVisible().catch(() => false)) {
      await sessionRow.click();
    } else {
      await page.locator('[data-testid="chat-item"]').first().click();
    }

    const input = page.getByTestId("chat-input");
    await expect(input).toBeVisible({ timeout: 15000 });
    await input.fill("/review");
    await page.getByRole("option").filter({ hasText: "/review" }).click();

    const chip = page.getByTestId("workflow-selection-chip");
    const argumentsEditor = page.getByRole("textbox", { name: "Workflow arguments (JSON)" });
    await expect(chip).toContainText("Review safely");
    await argumentsEditor.fill('{"scope":"tests","strict":true}');
    const draftImage = page.getByRole("button", { name: "View image typed-draft.png" });
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
      name: "typed-draft.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await expect(draftImage).toBeVisible();
    await input.fill("/review inspect src");
    await input.press("Enter");

    await expect.poll(() => chatAttempt).toBe(1);
    await expect(chip).toContainText("Workflow selection needs attention");
    await expect(chip).toContainText("The selected Workflow changed");
    await expect(input).toHaveValue("/review inspect src");
    await expect(argumentsEditor).toHaveValue('{"scope":"tests","strict":true}');
    await expect(draftImage).toBeVisible();
    expect(chatRequests[0]).toMatchObject({
      message: "inspect src",
      workflow_selection: {
        id: "review",
        source: "project",
        revision: 12,
        args: { scope: "tests", strict: true },
      },
    });

    catalogRevision = 13;
    await chip.getByRole("button", { name: "Refresh catalog" }).click();
    await page.getByRole("option").filter({ hasText: "/review" }).click();
    await expect(input).toHaveValue("/review inspect src");
    await expect(argumentsEditor).toHaveValue('{"scope":"tests","strict":true}');
    await input.press("Enter");

    await expect.poll(() => chatAttempt).toBe(2);
    await expect(draftImage).toHaveCount(0);
    expect(chatRequests[1]).toMatchObject({
      message: "inspect src",
      workflow_selection: {
        id: "review",
        source: "project",
        revision: 13,
        args: { scope: "tests", strict: true },
      },
    });
    expect(chatRequests[1]).not.toHaveProperty("selected_skill_ids");
    const serializedSelections = JSON.stringify(
      chatRequests.map((request) => request.workflow_selection),
    );
    expect(serializedSelections).not.toContain("expanded");
    expect(serializedSelections).not.toContain("PRIVATE");

    await expect(page.getByText(/Active Workflow: Review safely.*Explicit/)).toBeVisible();
    const activeCard = page.getByTestId("active-workflow-card");
    if (!(await activeCard.isVisible().catch(() => false))) {
      const inspectorButton = page.getByRole("button", {
        name: /Open inspector|Toggle inspector/,
      });
      await inspectorButton.click();
    }
    await expect(activeCard).toBeVisible();
    await expect(activeCard).toContainText("Review safely");
    await expect(activeCard).toContainText("project");
    await expect(activeCard).toContainText("13");
    await expect(activeCard).toContainText("Explicit · User");
    await expect(page.getByText("PRIVATE PROVIDER OUTPUT")).toHaveCount(0);
    await expect(page.getByText("/private/workflow/resource.md")).toHaveCount(0);

    const screenshotPath = path.resolve(
      __dirname,
      "../../docs/screenshots/issue-231-typed-workflow-activation.png",
    );
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach("typed Workflow active receipt", {
      path: screenshotPath,
      contentType: "image/png",
    });

    await page.reload();
    await expect(page.getByText(/Active Workflow: Review safely.*Explicit/)).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId("active-workflow-card")).toContainText("Review safely");
  });
});
