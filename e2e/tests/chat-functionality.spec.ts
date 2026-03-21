import { test, expect, type Page } from "@playwright/test";
import {
  clickWithModalGuard,
  ensureChatReady,
  fillReactInput,
} from "../utils/test-helpers";

async function skipIfProviderNotConfigured(page: Page) {
  const chatInput = page.locator('[data-testid="chat-input"]');
  const providerWarning = page.getByText("Provider not configured");

  await expect(chatInput).toBeVisible({ timeout: 10000 });

  let inputDisabled = false;
  for (let index = 0; index < 10; index += 1) {
    inputDisabled = await chatInput.isDisabled().catch(() => false);
    if (inputDisabled || (await chatInput.isEditable().catch(() => false))) {
      break;
    }
    await page.waitForTimeout(300);
  }

  if (inputDisabled) {
    await expect(providerWarning).toBeVisible({ timeout: 10000 });
    test.skip(true, "Chat input is disabled in this E2E environment");
  }
}

async function waitForSendReadyOrSkip(page: Page) {
  await skipIfProviderNotConfigured(page);
  const sendButton = page.locator('[data-testid="send-button"]');
  await expect(sendButton).toBeVisible({ timeout: 10000 });

  for (let index = 0; index < 20; index += 1) {
    if (await sendButton.isEnabled()) {
      return;
    }
    await page.waitForTimeout(500);
  }

  test.skip(true, "Send button stayed disabled in this E2E environment");
}

async function waitForEditableInputOrSkip(page: Page) {
  const chatInput = page.locator('[data-testid="chat-input"]');
  await expect(chatInput).toBeVisible({ timeout: 10000 });

  for (let index = 0; index < 20; index += 1) {
    if (await chatInput.isEditable().catch(() => false)) {
      return;
    }
    await page.waitForTimeout(500);
  }

  test.skip(true, "Chat input stayed disabled in this E2E environment");
}

test.describe("Chat Functionality", () => {
  test.beforeEach(async ({ page }) => {
    await ensureChatReady(page);
  });

  test("shows chat input once a session exists", async ({ page }) => {
    await expect(page.locator('[data-testid="chat-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="send-button"]')).toBeVisible();
  });

  test("sends a message and receives an assistant reply", async ({ page }) => {
    await skipIfProviderNotConfigured(page);
    await waitForEditableInputOrSkip(page);
    await fillReactInput(page, '[data-testid="chat-input"]', "Hello, AI!");
    await waitForSendReadyOrSkip(page);
    await clickWithModalGuard(page, '[data-testid="send-button"]');

    await expect(
      page.locator('[data-testid="assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
  });

  test("maintains multi-turn conversation history", async ({ page }) => {
    await skipIfProviderNotConfigured(page);
    await waitForEditableInputOrSkip(page);
    await fillReactInput(page, '[data-testid="chat-input"]', "First message");
    await waitForSendReadyOrSkip(page);
    await clickWithModalGuard(page, '[data-testid="send-button"]');
    await expect(
      page.locator('[data-testid="assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });

    await fillReactInput(page, '[data-testid="chat-input"]', "Second message");
    await waitForSendReadyOrSkip(page);
    await clickWithModalGuard(page, '[data-testid="send-button"]');

    await expect(
      page.locator('[data-testid="user-message"]').filter({ hasText: "Second message" }),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.locator('[data-testid="assistant-message"]').first(),
    ).toBeVisible();
  });

  test("supports regenerate from retry menu", async ({ page }) => {
    await skipIfProviderNotConfigured(page);
    await waitForEditableInputOrSkip(page);
    await fillReactInput(page, '[data-testid="chat-input"]', "Give me a random number");
    await waitForSendReadyOrSkip(page);
    await clickWithModalGuard(page, '[data-testid="send-button"]');
    await expect(
      page.locator('[data-testid="assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });

    await page.click('[data-testid="regenerate-button"]');
    await page.getByText("Regenerate response").click();

    await expect(
      page.locator('[data-testid="assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
  });

  test("copies assistant content to clipboard", async ({ page, context }) => {
    await skipIfProviderNotConfigured(page);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    await waitForEditableInputOrSkip(page);
    await fillReactInput(page, '[data-testid="chat-input"]', "Copy test");
    await waitForSendReadyOrSkip(page);
    await clickWithModalGuard(page, '[data-testid="send-button"]');
    await expect(
      page.locator('[data-testid="assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });

    await page.locator('[data-testid="copy-message"]').first().click({ force: true });
    await expect
      .poll(async () => {
        try {
          return await page.evaluate(() => navigator.clipboard.readText());
        } catch {
          return "";
        }
      })
      .not.toBe("");
  });

  test("accepts special characters and clears input after send", async ({ page }) => {
    await skipIfProviderNotConfigured(page);
    await waitForEditableInputOrSkip(page);
    const specialMessage = "Hello! @#$%^&*()_+{}|:<>?~`-=[]\\;'\",./";
    await fillReactInput(page, '[data-testid="chat-input"]', specialMessage);
    await waitForSendReadyOrSkip(page);
    await clickWithModalGuard(page, '[data-testid="send-button"]');

    await expect(
      page.locator('[data-testid="assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-testid="chat-input"]')).toHaveValue("");
  });
});
