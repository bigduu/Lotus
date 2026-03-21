import { test, expect } from "@playwright/test";
import { ensureChatReady } from "../../utils/test-helpers";

test.describe("Browser Mode Specific Tests", () => {
  test.use({ baseURL: "http://127.0.0.1:1420" });

  test("connects to backend health endpoint", async ({ page }) => {
    await page.goto("/");
    const healthResponse = await page.request.get("http://127.0.0.1:9562/api/v1/health");
    expect(healthResponse.ok()).toBeTruthy();
  });

  test("supports chat interaction in browser mode", async ({ page }) => {
    await ensureChatReady(page);
    await expect(page.locator('[data-testid="chat-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="send-button"]')).toBeVisible();
  });

  test("supports web clipboard api", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");

    await page.evaluate(async () => {
      await navigator.clipboard.writeText("clipboard-smoke-test");
    });
    const text = await page.evaluate(async () => navigator.clipboard.readText());
    expect(text).toBe("clipboard-smoke-test");
  });

  test("supports local and session storage", async ({ page }) => {
    await page.goto("/");

    await page.evaluate(() => {
      localStorage.setItem("e2e-local-key", "local-value");
      sessionStorage.setItem("e2e-session-key", "session-value");
    });

    const values = await page.evaluate(() => ({
      local: localStorage.getItem("e2e-local-key"),
      session: sessionStorage.getItem("e2e-session-key"),
    }));
    expect(values.local).toBe("local-value");
    expect(values.session).toBe("session-value");
  });

  test("renders in mobile and desktop viewports", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await expect(page.locator("body")).toBeVisible();
  });
});
