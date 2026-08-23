import { test, expect } from "@playwright/test";
import { openSettingsTab } from "../utils/test-helpers";

const workflowCatalogFixture = {
  revision: 36,
  entries: [
    {
      id: "e2e-ordinary-skill",
      name: "E2E Ordinary Skill",
      description: "An instruction Skill published in the unified Workflow Library.",
      kind: "instruction",
      source: "user",
      revision: 1,
      invocation_policy: { explicit: true, automatic: true },
      status: "valid",
      winner: true,
    },
    {
      id: "e2e-release-workflow",
      name: "E2E Release Workflow",
      description: "A real orchestration Workflow used by the browser contract.",
      kind: "orchestration",
      source: "plugin",
      revision: 2,
      invocation_policy: { explicit: true, automatic: true },
      status: "valid",
      winner: true,
    },
    {
      id: "e2e-legacy-workflow",
      name: "E2E Legacy Workflow",
      description: "An explicitly identified legacy Workflow.",
      kind: "instruction",
      source: "workspace",
      revision: 3,
      invocation_policy: { explicit: true, automatic: false },
      status: "degraded",
      winner: true,
      legacy: true,
    },
  ],
};

test.describe("Workflow Library", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/v1/bamboo/workflow-catalog*", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      await route.fulfill({ response, json: workflowCatalogFixture });
    });
    await openSettingsTab(page, "workflows");
    await expect(page.getByText("Catalog source: Typed")).toBeVisible({ timeout: 15000 });
  });

  test("renders instruction and orchestration metadata from the unified catalog", async ({
    page,
  }) => {
    await expect(page.getByText("Workflow Library", { exact: true })).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(3);
    await expect(page.getByText("E2E Ordinary Skill", { exact: true })).toBeVisible();
    await expect(page.getByText("E2E Release Workflow", { exact: true })).toBeVisible();
    await expect(page.getByText("E2E Legacy Workflow", { exact: true })).toBeVisible();
    const instruction = page.getByRole("article").filter({ hasText: "E2E Ordinary Skill" });
    const realWorkflow = page.getByRole("article").filter({ hasText: "E2E Release Workflow" });
    const legacyWorkflow = page.getByRole("article").filter({ hasText: "E2E Legacy Workflow" });
    await expect(instruction.getByText("Instruction", { exact: true })).toBeVisible();
    await expect(realWorkflow.getByText("Orchestration", { exact: true })).toBeVisible();
    await expect(realWorkflow.getByText("Legacy", { exact: true })).toHaveCount(0);
    await expect(legacyWorkflow.getByText("Legacy", { exact: true })).toBeVisible();
    await expect(legacyWorkflow.getByText("Instruction", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Search workflow catalog")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Filter by workflow kind" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Filter by workflow source" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Filter by workflow status" })).toBeVisible();
  });

  test("filters the unified Workflow catalog by search, kind, source, and status", async ({
    page,
  }) => {
    const search = page.getByLabel("Search workflow catalog");
    await search.fill("workflow-that-cannot-exist-125");
    await expect(page.getByText("No workflows match the current filters")).toBeVisible();

    await search.clear();
    await expect(page.getByRole("article")).toHaveCount(3);

    const kindFilter = page.getByRole("combobox", { name: "Filter by workflow kind" });
    await kindFilter.locator("xpath=../..").click();
    await page
      .locator(".ant-select-dropdown:visible .ant-select-item-option")
      .filter({ hasText: /^Instruction$/ })
      .click();
    await expect(page.getByText("E2E Ordinary Skill", { exact: true })).toBeVisible();
    await expect(page.getByText("E2E Legacy Workflow", { exact: true })).toBeVisible();
    await expect(page.getByText("E2E Release Workflow", { exact: true })).toHaveCount(0);

    await kindFilter.locator("xpath=../..").click();
    await page
      .locator(".ant-select-dropdown:visible .ant-select-item-option")
      .filter({ hasText: /^All kinds$/ })
      .click();

    const sourceFilter = page.getByRole("combobox", { name: "Filter by workflow source" });
    await sourceFilter.locator("xpath=../..").click();
    await page
      .locator(".ant-select-dropdown:visible .ant-select-item-option")
      .filter({ hasText: /^Plugin$/ })
      .click();
    await expect(page.getByText("E2E Release Workflow", { exact: true })).toBeVisible();
    await expect(page.getByText("E2E Legacy Workflow", { exact: true })).toHaveCount(0);

    await sourceFilter.locator("xpath=../..").click();
    await page
      .locator(".ant-select-dropdown:visible .ant-select-item-option")
      .filter({ hasText: /^All sources$/ })
      .click();
    const statusFilter = page.getByRole("combobox", { name: "Filter by workflow status" });
    await statusFilter.locator("xpath=../..").click();
    await page
      .locator(".ant-select-dropdown:visible .ant-select-item-option")
      .filter({ hasText: /^Degraded$/ })
      .click();
    await expect(page.getByText("E2E Legacy Workflow", { exact: true })).toBeVisible();
    await expect(page.getByText("E2E Release Workflow", { exact: true })).toHaveCount(0);
    await expect(page.getByText("E2E Ordinary Skill", { exact: true })).toHaveCount(0);
  });

  test("keeps unsupported typed actions disabled", async ({ page }) => {
    const workflow = page.getByRole("article").filter({ hasText: "E2E Release Workflow" });
    await expect(
      workflow.getByRole("button", { name: "Clone E2E Release Workflow" }),
    ).toBeDisabled();
    await expect(
      workflow.getByRole("button", { name: "Edit E2E Release Workflow" }),
    ).toBeDisabled();
    await expect(workflow.getByRole("button", { name: "Run E2E Release Workflow" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "New workflow" })).toHaveCount(0);
  });
});
