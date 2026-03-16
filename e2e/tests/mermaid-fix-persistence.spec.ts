import { expect, test } from "@playwright/test";

test.describe("Mermaid Fix Persistence", () => {
  test("should persist fixed mermaid content after page reload", async ({
    page,
  }) => {
    const sessionId = "session-mermaid-1";
    const messageId = "assistant-mermaid-1";
    const now = new Date().toISOString();
    let persistedAssistantContent = [
      "```mermaid",
      "graph TD",
      "A -->",
      "```",
    ].join("\n");
    let patchCallCount = 0;

    await page.route("**/api/v1/health", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/plain",
        body: "OK",
      });
    });

    await page.route("**/api/v1/sessions**", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          sessions: [
            {
              id: sessionId,
              kind: "root",
              title: "Mermaid Fix Session",
              pinned: false,
              parent_session_id: null,
              root_session_id: sessionId,
              spawn_depth: 0,
              created_by_schedule_id: null,
              created_at: now,
              updated_at: now,
              last_activity_at: now,
              message_count: 2,
              has_attachments: false,
              is_running: false,
            },
          ],
        }),
      });
    });

    await page.route("**/api/v1/history/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          session_id: sessionId,
          messages: [
            {
              id: "system-message-1",
              role: "system",
              content: "You are a helpful assistant.",
              created_at: now,
            },
            {
              id: messageId,
              role: "assistant",
              content: persistedAssistantContent,
              created_at: now,
            },
          ],
        }),
      });
    });

    await page.route("**/api/v1/sessions/**/messages/**", async (route) => {
        const method = route.request().method();
        if (method !== "PATCH") {
          await route.continue();
          return;
        }

        const raw = route.request().postData() || "{}";
        const payload = JSON.parse(raw) as { content?: string };
        if (typeof payload.content === "string" && payload.content.trim()) {
          persistedAssistantContent = payload.content;
          patchCallCount += 1;
        }

        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            session_id: sessionId,
            message_id: messageId,
            message_count: 2,
          }),
        });
      });

    await page.route("**/openai/v1/chat/completions", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "chatcmpl-mermaid-fix-1",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "gpt-5",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "graph TD\nA --> B",
              },
            },
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
          },
        }),
      });
    });

    await page.goto("/chat");

    await expect(page.locator('[data-testid="assistant-message"]')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("Mermaid Diagram Error")).toBeVisible();
    await expect(page.getByRole("button", { name: "Fix Mermaid" })).toBeVisible();

    await page.getByRole("button", { name: "Fix Mermaid" }).click();

    await expect
      .poll(() => patchCallCount, {
        timeout: 10000,
      })
      .toBe(1);
    await expect(page.getByText("Mermaid Diagram Error")).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Fix Mermaid" })).not.toBeVisible();

    await page.reload();

    await expect(page.locator('[data-testid="assistant-message"]')).toBeVisible();
    await expect(page.getByText("Mermaid Diagram Error")).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Fix Mermaid" })).not.toBeVisible();
  });
});
