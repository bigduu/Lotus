import { test, expect } from "@playwright/test";
import { openSettingsTab } from "../utils/test-helpers";

test.describe("Workflow Library", () => {
  test.beforeEach(async ({ page }) => {
    await openSettingsTab(page, "workflows");
    await expect(page.getByText("Catalog source: Typed")).toBeVisible({ timeout: 15000 });
  });

  test("renders the typed workflow catalog", async ({ page }) => {
    await expect(page.getByText("Workflow Library", { exact: true })).toBeVisible();
    await expect(page.getByRole("article").first()).toBeVisible();
    await expect(page.getByLabel("Search workflow catalog")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Filter by workflow kind" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Filter by workflow source" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Filter by workflow status" })).toBeVisible();
  });

  test("filters the catalog without creating local workflow state", async ({ page }) => {
    const search = page.getByLabel("Search workflow catalog");
    await search.fill("workflow-that-cannot-exist-125");
    await expect(page.getByText("No workflows match the current filters")).toBeVisible();

    await search.clear();
    await expect(page.getByRole("article").first()).toBeVisible();
  });

  test("keeps unsupported typed actions disabled", async ({ page }) => {
    await expect(page.getByRole("button", { name: /^Clone / }).first()).toBeDisabled();
    await expect(page.getByRole("button", { name: /^Edit / }).first()).toBeDisabled();
    await expect(page.getByRole("button", { name: /^Run / }).first()).toBeDisabled();
    await expect(page.getByRole("button", { name: "New workflow" })).toHaveCount(0);
  });
});
