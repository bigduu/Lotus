import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  cleanupProjectFixture,
  configureProjectFirstPage,
  createBackendContext,
  createProject,
  createSession,
  createWorkspaceFixture,
} from "../utils/project-first-helpers";

/**
 * Browser coverage for the Project-group header accessibility restructure
 * (Lotus #202). Unit tests prove the DOM contract (native toggle button,
 * sibling actions, focus order); this spec proves what jsdom cannot —
 * real Enter/Space keyboard activation in a browser engine:
 *
 *  - the expand/collapse toggle is a standalone native button whose
 *    keyboard activation collapses/expands the group;
 *  - Create/Delete are separate sibling controls (never nested inside the
 *    toggle), reachable by Tab right after it;
 *  - keyboard-activating Create/Delete never collapses the group.
 *
 * The keyboard collapse/expand assertions run against a group whose
 * session is NOT selected — Lotus intentionally force-expands the group
 * that contains the current session (#134), so a selected group can never
 * collapse regardless of the input method.
 */

const loadChat = async (page: Parameters<typeof configureProjectFirstPage>[0]) => {
  await page.goto("/chat");
  await expect(page.getByTestId("project-switcher")).toBeVisible({ timeout: 20_000 });
};

test.describe("Sidebar Project group toggle a11y (#202)", () => {
  test.describe.configure({ mode: "serial" });

  let api: APIRequestContext;

  test.beforeEach(async ({ page }) => {
    api = await createBackendContext();
    await configureProjectFirstPage(page);
  });

  test.afterEach(async () => {
    await api.dispose();
  });

  test("toggle is an explicit button; Create/Delete are siblings; keyboard never cross-fires", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const fixture = await createWorkspaceFixture(testInfo, "group-toggle-a11y");
    const suffix = `${testInfo.workerIndex}-${Date.now()}`;
    const projectNameA = `e2e-202-toggle-a-${suffix}`;
    const projectNameB = `e2e-202-toggle-b-${suffix}`;
    const sessionIds: string[] = [];
    const projectIds: string[] = [];

    try {
      const projectA = await createProject(api, {
        name: projectNameA,
        projectPath: fixture.primary,
      });
      const projectB = await createProject(api, {
        name: projectNameB,
        projectPath: fixture.secondary,
      });
      projectIds.push(projectA.id, projectB.id);
      const sessionA = await createSession(api, {
        title: `e2e-202-session-a-${suffix}`,
        projectId: projectA.id,
        workspacePath: fixture.primary,
      });
      const sessionB = await createSession(api, {
        title: `e2e-202-session-b-${suffix}`,
        projectId: projectB.id,
        workspacePath: fixture.secondary,
      });
      sessionIds.push(sessionA.id, sessionB.id);

      await loadChat(page);

      // Select Project B's session so Project A's group is free to
      // collapse (the selected session's group is force-expanded).
      const groupB = page.getByRole("button", { name: `${projectNameB} (1)` });
      await expect(groupB).toBeVisible({ timeout: 20_000 });
      await page.getByRole("option", { name: sessionB.title }).click();

      const groupNameA = (count: number) => `${projectNameA} (${count})`;
      const toggle = page.getByRole("button", { name: groupNameA(1) });
      await expect(toggle).toBeVisible();

      // The toggle is a standalone native button: no interactive
      // descendants, no tabindex/role hacks on the header row container.
      await expect(toggle.locator("button")).toHaveCount(0);
      const headerRow = page.locator(".chat-sidebar-date-group-header", { has: toggle });
      await expect(headerRow).not.toHaveAttribute("role", "button");
      await expect(headerRow).not.toHaveAttribute("tabindex");

      const createButton = headerRow.getByRole("button", {
        name: "Create session in this project",
      });
      const deleteButton = headerRow.locator(".chat-sidebar-date-group-delete");
      await expect(createButton).toBeAttached();
      await expect(deleteButton).toBeAttached();

      // Real keyboard activation of the toggle (native button behavior
      // jsdom cannot simulate): Enter expands, Space collapses, Enter
      // re-expands. Project A starts collapsed — only the selected
      // session's group (B) auto-expands on load.
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await toggle.focus();
      await page.keyboard.press("Enter");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("Space");
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await page.keyboard.press("Enter");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");

      // Tab focus order from the toggle: Create, then Delete.
      await toggle.focus();
      await page.keyboard.press("Tab");
      await expect(createButton).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(deleteButton).toBeFocused();

      // Keyboard-activating Create must not collapse the group — it
      // creates a session instead (count 1 → 2, group stays expanded).
      await createButton.focus();
      const createResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/api/v1/sessions",
      );
      await page.keyboard.press("Enter");
      const createResponse = await createResponsePromise;
      expect(createResponse.ok(), await createResponse.text()).toBe(true);
      const createBody = (await createResponse.json()) as { session?: { id?: string } };
      expect(createBody.session?.id).toBeTruthy();
      sessionIds.push(createBody.session?.id as string);

      // Focus moved on after activation; re-anchor on the renamed group.
      // The new session becomes the selected one, which also pins the
      // group open — either way it must not have collapsed.
      const renamedToggle = page.getByRole("button", { name: groupNameA(2) });
      await expect(renamedToggle).toHaveAttribute("aria-expanded", "true", { timeout: 20_000 });

      // Keyboard-activating Delete opens the confirmation dialog; it must
      // not collapse the group, and cancelling leaves everything intact.
      // Re-anchor: the header row re-rendered when the count changed.
      const renamedHeaderRow = page.locator(".chat-sidebar-date-group-header", {
        has: renamedToggle,
      });
      const renamedDelete = renamedHeaderRow.locator(".chat-sidebar-date-group-delete");
      await renamedDelete.focus();
      await page.keyboard.press("Space");
      const confirmDialog = page.getByRole("dialog");
      await expect(confirmDialog).toBeVisible();
      await expect(renamedToggle).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("Escape");
      await expect(confirmDialog).not.toBeVisible();
      await expect(renamedToggle).toHaveAttribute("aria-expanded", "true");
    } finally {
      await cleanupProjectFixture(api, fixture, sessionIds, projectIds);
    }
  });
});
