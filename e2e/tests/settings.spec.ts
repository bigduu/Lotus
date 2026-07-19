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

    // The provider tab renders in one of two modes: instance mode when the
    // backend's provider-instances endpoint returns a list (the default on a
    // fresh data dir — ProviderSettings/index.tsx's mount effect flips
    // isInstanceMode unconditionally whenever that call succeeds, even with
    // an empty list), legacy single-provider mode when it doesn't. Detect
    // by data-testid (mode-specific, i18n-independent) rather than assuming
    // one mode, so the test stays correct against either backend shape.
    const providerSelect = page.locator('[data-testid="provider-select"]');
    const addProviderInstance = page.locator('[data-testid="add-provider-instance"]');
    await expect(providerSelect.or(addProviderInstance).first()).toBeVisible({
      timeout: 15000,
    });

    if (await providerSelect.isVisible().catch(() => false)) {
      // Legacy mode: the per-provider API key form is reachable.
      const apiKeyInput = page.locator('[data-testid="api-key-input"]');
      if (!(await apiKeyInput.isVisible().catch(() => false))) {
        const openAiPanel = page.getByRole("button", { name: /openai/i }).first();
        if (await openAiPanel.isVisible().catch(() => false)) {
          await openAiPanel.click();
        }
      }

      await expect(apiKeyInput).toBeVisible({ timeout: 15000 });
    }
    // else: instance mode — the provider-instances panel is already confirmed
    // reachable above via the "Add Provider" control.

    // Both modes share the same form submit button (ProviderSettings/index.tsx
    // renders it once, outside the isInstanceMode branch): legacy mode's
    // per-provider save, instance mode's "Save and Apply Configuration".
    await expect(page.locator('[data-testid="save-api-settings"]')).toBeVisible();
  });

  test("allows editing proxy settings in config tab", async ({ page }) => {
    await page.click('[data-testid="settings-tab-config"]');
    await expect(page.locator('[data-testid="proxy-url"]')).toBeVisible();

    await page.fill('[data-testid="proxy-url"]', "http://127.0.0.1:8080");
    await page.click('[data-testid="save-proxy-settings"]');
    await expect(page.locator('[data-testid="proxy-url"]')).toHaveValue("http://127.0.0.1:8080");
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

  test("shows workflow library controls", async ({ page }) => {
    await openSettingsTab(page, "workflows");
    await expect(page.getByText("Workflow Library", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Search workflow catalog")).toBeVisible();
    await expect(page.getByLabel("Filter by workflow kind")).toBeVisible();
    await expect(page.getByLabel("Filter by workflow source")).toBeVisible();
    await expect(page.getByLabel("Filter by workflow status")).toBeVisible();
  });

  test("shows keyword masking controls", async ({ page }) => {
    await openSettingsTab(page, "masking");
    await expect(page.locator('[data-testid="add-keyword"]')).toBeVisible();
  });
});
