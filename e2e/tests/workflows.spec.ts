import { test, expect } from "@playwright/test";
import { openSettingsTab } from "../utils/test-helpers";

const uniqueWorkflowName = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`.replace(
    /[^a-zA-Z0-9-_]/g,
    "-",
  );

test.describe("Workflow Management", () => {
  test.beforeEach(async ({ page }) => {
    await openSettingsTab(page, "workflows");
  });

  test("creates a workflow", async ({ page }) => {
    const name = uniqueWorkflowName("test-workflow");
    const content = "# Test Workflow\n\nCreated by E2E.";

    await page.click('[data-testid="create-workflow"]');
    await page.fill('[data-testid="workflow-name"]', name);
    await page.fill('[data-testid="workflow-content"]', content);
    await page.click('[data-testid="save-workflow"]');

    await expect(page.getByText(`/${name}`)).toBeVisible({ timeout: 10000 });
  });

  test("edits an existing workflow", async ({ page }) => {
    const name = uniqueWorkflowName("edit-workflow");
    const initialContent = "# Initial Content";
    const updatedContent = "# Updated Content\n\nThis workflow was updated.";

    await page.click('[data-testid="create-workflow"]');
    await page.fill('[data-testid="workflow-name"]', name);
    await page.fill('[data-testid="workflow-content"]', initialContent);
    await page.click('[data-testid="save-workflow"]');
    await expect(page.getByText(`/${name}`)).toBeVisible({ timeout: 10000 });

    await page.getByText(`/${name}`).click();
    await page.fill('[data-testid="workflow-content"]', updatedContent);
    await page.click('[data-testid="save-workflow"]');

    await expect(page.locator('[data-testid="workflow-content"]')).toHaveValue(
      updatedContent,
    );
  });

  test("deletes a workflow", async ({ page }) => {
    const name = uniqueWorkflowName("delete-workflow");

    await page.click('[data-testid="create-workflow"]');
    await page.fill('[data-testid="workflow-name"]', name);
    await page.fill('[data-testid="workflow-content"]', "# Delete Me");
    await page.click('[data-testid="save-workflow"]');
    await expect(page.getByText(`/${name}`)).toBeVisible({ timeout: 10000 });

    await page.click(`[data-testid="delete-workflow-${name}"]`);
    await expect(page.getByText(`/${name}`)).not.toBeVisible();
  });
});
