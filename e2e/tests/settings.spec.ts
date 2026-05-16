import { test, expect } from "@playwright/test";
import { openSettingsPage, openSettingsTab } from "../utils/test-helpers";

test.describe("Settings Management", () => {
  test.beforeEach(async ({ page }) => {
    await openSettingsPage(page);
  });

  test("shows core settings tabs", async ({ page }) => {
    await expect(page.locator('[data-testid="settings-tab-provider"]')).toBeVisible();
    await expect(page.locator('[data-testid="settings-tab-config"]')).toBeVisible();
    await expect(page.locator('[data-testid="settings-tab-workflows"]')).toBeVisible();
    await expect(page.locator('[data-testid="settings-tab-masking"]')).toBeVisible();
    await expect(page.locator('[data-testid="settings-tab-app"]')).toBeVisible();
  });

  test("loads provider configuration controls", async ({ page }) => {
    await page.click('[data-testid="settings-tab-provider"]');
    await expect(page.locator('[data-testid="provider-select"]')).toBeVisible();

    const apiKeyInput = page.locator('[data-testid="api-key-input"]');
    if (!(await apiKeyInput.isVisible().catch(() => false))) {
      const openAiPanel = page.getByRole("button", { name: /openai/i }).first();
      if (await openAiPanel.isVisible().catch(() => false)) {
        await openAiPanel.click();
      }
    }

    await expect(apiKeyInput).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="save-api-settings"]')).toBeVisible();
  });

  test("allows editing proxy settings in config tab", async ({ page }) => {
    await page.click('[data-testid="settings-tab-config"]');
    await expect(page.locator('[data-testid="proxy-url"]')).toBeVisible();

    await page.fill('[data-testid="proxy-url"]', "http://127.0.0.1:8080");
    await page.click('[data-testid="save-proxy-settings"]');
    await expect(page.locator('[data-testid="proxy-url"]')).toHaveValue(
      "http://127.0.0.1:8080",
    );
  });

  test("toggles app theme from app tab", async ({ page }) => {
    await page.click('[data-testid="settings-tab-app"]');
    const toggle = page.locator('[data-testid="dark-mode-toggle"]');
    await expect(toggle).toBeVisible();

    const initialTheme = await page.locator("body").getAttribute("data-theme");
    await toggle.click();
    const nextTheme = await page.locator("body").getAttribute("data-theme");
    expect(nextTheme).not.toBe(initialTheme);
  });

  test("shows workflows management controls", async ({ page }) => {
    await openSettingsTab(page, "workflows");
    await expect(page.locator('[data-testid="create-workflow"]')).toBeVisible();
    await expect(page.locator('[data-testid="workflow-name"]')).toBeVisible();
    await expect(page.locator('[data-testid="workflow-content"]')).toBeVisible();
    await expect(page.locator('[data-testid="save-workflow"]')).toBeVisible();
  });

  test("shows keyword masking controls", async ({ page }) => {
    await openSettingsTab(page, "masking");
    await expect(page.locator('[data-testid="add-keyword"]')).toBeVisible();
  });
});
