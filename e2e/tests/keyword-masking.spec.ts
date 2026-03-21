import { test, expect } from "@playwright/test";
import { openSettingsTab } from "../utils/test-helpers";

const uniquePattern = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

test.describe("Keyword Masking", () => {
  test.beforeEach(async ({ page }) => {
    await openSettingsTab(page, "masking");
  });

  test("adds a keyword masking entry", async ({ page }) => {
    const pattern = uniquePattern("secret-token");
    await page.click('[data-testid="add-keyword"]');
    await page.fill('[data-testid="keyword-pattern-input"]', pattern);
    await page.click('[data-testid="save-keyword"]');

    await expect(page.getByText(pattern)).toBeVisible({ timeout: 10000 });
  });

  test("keeps entry in edit mode when pattern is empty", async ({ page }) => {
    await page.click('[data-testid="add-keyword"]');
    await page.fill('[data-testid="keyword-pattern-input"]', "");
    await page.click('[data-testid="save-keyword"]');

    await expect(page.locator('[data-testid="save-keyword"]')).toBeVisible();
    await expect(page.locator('[data-testid="keyword-pattern-input"]')).toHaveValue("");
  });

  test("toggles keyword enabled state", async ({ page }) => {
    const pattern = uniquePattern("toggle-entry");
    await page.click('[data-testid="add-keyword"]');
    await page.fill('[data-testid="keyword-pattern-input"]', pattern);
    await page.click('[data-testid="save-keyword"]');
    await expect(page.getByText(pattern)).toBeVisible({ timeout: 10000 });

    const row = page.locator(".ant-list-item").filter({ hasText: pattern }).first();
    const switchControl = row.getByRole("switch").first();
    const before = await switchControl.getAttribute("aria-checked");
    await switchControl.click();
    await expect(switchControl).toHaveAttribute(
      "aria-checked",
      before === "true" ? "false" : "true",
    );
  });

  test("deletes an existing keyword entry", async ({ page }) => {
    const pattern = uniquePattern("delete-me");
    await page.click('[data-testid="add-keyword"]');
    await page.fill('[data-testid="keyword-pattern-input"]', pattern);
    await page.click('[data-testid="save-keyword"]');
    await expect(page.getByText(pattern)).toBeVisible({ timeout: 10000 });

    const row = page.locator(".ant-list-item").filter({ hasText: pattern }).first();
    await row.locator('button[data-testid^="delete-keyword-"]').click();
    await expect(page.getByText(pattern)).not.toBeVisible();
  });
});
