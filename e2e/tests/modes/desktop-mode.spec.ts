import { test, expect } from "@playwright/test";
import { ensureChatReady } from "../../utils/test-helpers";

test.describe("Desktop Mode Specific Tests", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    const hasTauriRuntime = await page.evaluate(() => {
      const w = window as unknown as {
        __TAURI__?: unknown;
        __TAURI_INTERNALS__?: unknown;
      };
      return Boolean(w.__TAURI__ || w.__TAURI_INTERNALS__);
    });

    test.skip(!hasTauriRuntime, "Desktop mode tests require Tauri runtime");
  });

  test("supports chat UI under desktop runtime", async ({ page }) => {
    await ensureChatReady(page);
    await expect(page.locator('[data-testid="chat-input"]')).toBeVisible();
  });

  test("supports opening a second window context", async ({ context }) => {
    const page2 = await context.newPage();
    await page2.goto("/");
    await expect(page2.locator("body")).toBeVisible();
    await page2.close();
  });
});
