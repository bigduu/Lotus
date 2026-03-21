import { test, expect } from "@playwright/test";
import {
  ensureChatReady,
  ensureSidebarVisible,
  waitForAppReady,
} from "../utils/test-helpers";

test.describe("Setup Flow", () => {
  test("bypasses setup after global setup completion", async ({ page }) => {
    await page.goto("/");
    await waitForAppReady(page);
    await ensureSidebarVisible(page);

    await expect(page.locator('[data-testid="setup-next"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="open-settings"]')).toBeVisible();
  });

  test("lands in usable chat mode without setup wizard", async ({ page }) => {
    await ensureChatReady(page);
    await expect(page.locator('[data-testid="chat-input"]')).toBeVisible();
  });
});
