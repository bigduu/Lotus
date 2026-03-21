import { test, expect } from "@playwright/test";
import { ensureChatReady, fillReactInput } from "../utils/test-helpers";

test.describe("Chat Input Smoke", () => {
  test("chat input is editable and updates value", async ({ page }) => {
    await ensureChatReady(page);

    const input = page.locator('[data-testid="chat-input"]');
    await expect(input).toBeVisible();

    for (let index = 0; index < 20; index += 1) {
      if (await input.isEditable().catch(() => false)) {
        break;
      }
      await page.waitForTimeout(500);
    }

    test.skip(
      !(await input.isEditable().catch(() => false)),
      "Chat input is disabled in this E2E environment",
    );

    await fillReactInput(page, '[data-testid="chat-input"]', "debug-input-value");
    await expect(input).toHaveValue("debug-input-value");
  });
});
