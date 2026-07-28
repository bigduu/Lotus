import { Page, expect } from '@playwright/test';

const APP_READY_SELECTORS = [
  '[data-testid="chat-input"]',
  '[data-testid="open-settings"]',
  '[data-testid="new-chat"]',
  '[data-testid="setup-wizard"]',
  '[data-testid="settings-page-title"]',
  '[data-testid="show-sidebar"]',
];

export async function waitForAppReady(page: Page) {
  // Wait for app to be fully loaded
  await page.waitForLoadState('domcontentloaded');

  // Wait for React to hydrate and render at least one stable app shell element.
  await page.waitForFunction((selectors: string[]) => {
    const root = document.querySelector('#root');
    if (!root || root.children.length === 0) {
      return false;
    }

    const text = (root.textContent || '').trim();
    if (text === 'Loading...' || text.length === 0) {
      return false;
    }

    return selectors.some((selector) => Boolean(document.querySelector(selector)));
  }, APP_READY_SELECTORS, { timeout: 30000 });
}

export async function completeSetupIfNeeded(page: Page) {
  // Check if setup is needed
  await page.goto('/');

  const setupWizard = page.locator('[data-testid="setup-wizard"]');
  const isVisible = await setupWizard.isVisible().catch(() => false);

  if (isVisible) {
    // Complete setup
    await page.fill('[data-testid="api-key-input"]', 'test-api-key');
    await page.click('[data-testid="setup-next"]');

    // Wait for redirect to chat
    await page.waitForURL(/.*\/chat/, { timeout: 10000 });
  }
}

export async function ensureSidebarVisible(page: Page) {
  const showSidebarButton = page.locator('[data-testid="show-sidebar"]');
  if (await showSidebarButton.isVisible().catch(() => false)) {
    await showSidebarButton.click();
  }
}

async function dismissBlockingModal(page: Page): Promise<void> {
  const modalWrap = page.locator('.ant-modal-wrap').first();
  if (!(await modalWrap.isVisible().catch(() => false))) {
    return;
  }

  const createSessionButton = page.getByRole('button', {
    name: 'Create New Session',
    exact: true,
  });
  if (await createSessionButton.isVisible().catch(() => false)) {
    if (await createSessionButton.isDisabled().catch(() => false)) {
      const firstPrompt = page.locator('.ant-modal [role="listitem"]').first();
      if (await firstPrompt.isVisible().catch(() => false)) {
        await firstPrompt.click();
      }
    }

    if (!(await createSessionButton.isDisabled().catch(() => true))) {
      await createSessionButton.click();
      await page.waitForTimeout(250);
      return;
    }
  }

  const closeButton = page.locator('.ant-modal-close').first();
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
  } else {
    await page.keyboard.press('Escape');
  }

  await page.waitForTimeout(250);
}

export async function clickWithModalGuard(
  page: Page,
  selector: string,
  attempts = 3
): Promise<void> {
  let lastError: unknown;

  for (let index = 0; index < attempts; index += 1) {
    try {
      await page.click(selector, { timeout: 15000 });
      return;
    } catch (error) {
      lastError = error;
      const message = String(error);
      const isModalInterception =
        message.includes('intercepts pointer events') ||
        message.includes('ant-modal-wrap');

      if (!isModalInterception) {
        throw error;
      }

      await dismissBlockingModal(page);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to click ${selector} after modal guard retries`);
}

export async function ensureChatReady(page: Page) {
  // Chat-ready scenarios exercise the post-onboarding application. Seed this
  // before navigation so the delayed feature tour cannot mask later actions.
  await page.addInitScript(() => {
    localStorage.setItem('bodhi_onboarding_complete', 'true');
  });
  await page.goto('/');
  await waitForAppReady(page);
  await ensureSidebarVisible(page);
  await dismissBlockingModal(page);

  const resolveSystemPromptModal = async () => {
    const modal = page.getByRole('dialog', {
      name: /Create New Session - Select System Prompt/i,
    });

    if (!(await modal.isVisible().catch(() => false))) {
      return;
    }

    const createButton = modal.getByRole('button', {
      name: 'Create New Session',
      exact: true,
    });

    if (!(await createButton.isVisible().catch(() => false))) {
      await page.keyboard.press('Escape');
      await expect(modal).toBeHidden({ timeout: 10000 });
      return;
    }

    if (await createButton.isDisabled()) {
      const firstPrompt = modal.locator('[role="listitem"]').first();
      if (await firstPrompt.isVisible().catch(() => false)) {
        await firstPrompt.click();
      }
    }

    await createButton.click();
    await expect(modal).toBeHidden({ timeout: 10000 });
  };

  await resolveSystemPromptModal();
  await dismissBlockingModal(page);

  const chatInput = page.locator('[data-testid="chat-input"]');
  if (!(await chatInput.isVisible().catch(() => false))) {
    const firstChatItem = page.locator('[data-testid="chat-item"]').first();
    if (await firstChatItem.isVisible().catch(() => false)) {
      await firstChatItem.click();
      await resolveSystemPromptModal();
      await dismissBlockingModal(page);
    }
  }

  if (!(await chatInput.isVisible().catch(() => false))) {
    const newChatButton = page.locator('[data-testid="new-chat"]');
    await expect(newChatButton).toBeVisible({ timeout: 10000 });
    await newChatButton.click();
    await resolveSystemPromptModal();
    await dismissBlockingModal(page);
  }

  await dismissBlockingModal(page);
  await expect(chatInput).toBeVisible({ timeout: 15000 });
}

export async function openSettingsPage(page: Page) {
  const settingsTitle = page.locator('[data-testid="settings-page-title"]');
  if (!(await settingsTitle.isVisible().catch(() => false))) {
    await page.goto('/');
    await waitForAppReady(page);
    await ensureSidebarVisible(page);
    await dismissBlockingModal(page);

    const modal = page.getByRole('dialog', {
      name: /Create New Session - Select System Prompt/i,
    });
    if (await modal.isVisible().catch(() => false)) {
      const closeButton = modal.getByRole('button', { name: /close/i });
      if (await closeButton.isVisible().catch(() => false)) {
        await closeButton.click();
      } else {
        await page.keyboard.press('Escape');
      }
      await expect(modal).toBeHidden({ timeout: 10000 });
    }

    const openSettingsButton = page.locator('[data-testid="open-settings"]');
    await expect(openSettingsButton).toBeVisible({ timeout: 20000 });
    await openSettingsButton.click();
  }

  await expect(settingsTitle).toBeVisible({ timeout: 15000 });
}

export async function openSettingsTab(page: Page, key: string) {
  const settingsTitle = page.locator('[data-testid="settings-page-title"]');
  if (!(await settingsTitle.isVisible().catch(() => false))) {
    await openSettingsPage(page);
  }

  const tab = page.locator(`[data-testid="settings-tab-${key}"]`);
  await expect(tab).toBeVisible({ timeout: 10000 });
  await tab.click();
}

export async function clearChatHistory(page: Page) {
  await page.goto('/chat');

  // Click clear history button if available
  const clearButton = page.locator('[data-testid="clear-history"]');

  if (await clearButton.isVisible().catch(() => false)) {
    await clearButton.click();

    // Confirm deletion
    const confirmButton = page.locator('[data-testid="confirm-clear"]');
    if (await confirmButton.isVisible().catch(() => false)) {
      await confirmButton.click();
    }
  }
}

export async function takeScreenshotOnFailure(page: Page, testName: string) {
  const screenshot = await page.screenshot({
    path: `test-results/${testName}-failure.png`,
    fullPage: true
  });

  return screenshot;
}

export async function mockApiError(page: Page, endpoint: string, status: number = 500) {
  await page.route(`**/api/v1/${endpoint}`, route => {
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Test error' })
    });
  });
}

export async function mockApiResponse(page: Page, endpoint: string, data: any, status: number = 200) {
  await page.route(`**/api/v1/${endpoint}`, route => {
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(data)
    });
  });
}

export async function waitForToast(page: Page, expectedText?: string, timeout = 5000) {
  const toast = page.locator('[data-testid="toast-message"]');

  await toast.waitFor({ state: 'visible', timeout });

  if (expectedText) {
    await expect(toast).toContainText(expectedText);
  }

  return toast;
}

export async function dismissToast(page: Page) {
  const closeButton = page.locator('[data-testid="toast-close"]');

  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
  }
}

export async function checkAccessibility(page: Page) {
  // Basic accessibility checks
  const violations: string[] = [];

  // Check for alt text on images
  const images = await page.locator('img').all();
  for (const img of images) {
    const alt = await img.getAttribute('alt');
    if (alt === null) {
      violations.push('Image missing alt text');
    }
  }

  // Check for form labels
  const inputs = await page.locator('input, textarea, select').all();
  for (const input of inputs) {
    const id = await input.getAttribute('id');
    if (id) {
      const label = await page.locator(`label[for="${id}"]`).count();
      if (label === 0) {
        violations.push(`Input ${id} missing label`);
      }
    }
  }

  // Check for heading hierarchy
  const h1 = await page.locator('h1').count();
  if (h1 > 1) {
    violations.push('Multiple h1 headings found');
  }

  return violations;
}

export async function measurePerformance(page: Page) {
  const metrics = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;

    return {
      loadTime: navigation.loadEventEnd - navigation.startTime,
      domContentLoaded: navigation.domContentLoadedEventEnd - navigation.startTime,
      firstPaint: navigation.responseStart - navigation.startTime,
      transferSize: navigation.transferSize,
    };
  });

  return metrics;
}

export async function retryOperation<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

export async function waitForAnimation(page: Page, selector: string) {
  // Wait for element to be visible and animations to complete
  await page.waitForSelector(selector, { state: 'visible' });

  await page.waitForFunction((sel) => {
    const element = document.querySelector(sel);
    if (!element) return false;

    const animations = element.getAnimations();
    return animations.every(anim => anim.playState === 'finished');
  }, selector);
}

export function generateTestName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export async function debugPageState(page: Page) {
  const url = page.url();
  const title = await page.title();

  const consoleLogs: string[] = [];
  page.on('console', msg => consoleLogs.push(msg.text()));

  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  return {
    url,
    title,
    consoleLogs,
    errors
  };
}

/**
 * Fill a React controlled input and trigger proper events
 * This ensures that React state updates correctly when filling inputs
 */
export async function fillReactInput(
  page: Page,
  selector: string,
  value: string
): Promise<void> {
  const input = page.locator(selector);
  await expect(input).toBeVisible({ timeout: 10000 });
  await input.fill('');
  await input.fill(value);

  const actualValue = await input.inputValue({ timeout: 5000 });
  console.log(`fillReactInput: Expected "${value}", got "${actualValue}"`);

  if (actualValue !== value) {
    throw new Error(`Failed to set input value. Expected "${value}", got "${actualValue}"`);
  }
}

/**
 * Wait for an input to be enabled (not disabled)
 */
export async function waitForInputEnabled(
  page: Page,
  selector: string,
  timeout = 5000
): Promise<void> {
  const input = page.locator(selector);
  await input.waitFor({ state: 'visible', timeout });

  // Wait for the disabled attribute to be removed
  await page.waitForFunction(
    (sel) => {
      const element = document.querySelector(sel);
      return element && !element.hasAttribute('disabled');
    },
    selector,
    { timeout }
  );
}

/**
 * Wait for a button to be enabled (not disabled)
 */
export async function waitForButtonEnabled(
  page: Page,
  selector: string,
  timeout = 5000
): Promise<void> {
  const button = page.locator(selector);
  await button.waitFor({ state: 'visible', timeout });

  // Wait for the disabled attribute to be removed
  await page.waitForFunction(
    (sel) => {
      const element = document.querySelector(sel);
      return element && !element.hasAttribute('disabled');
    },
    selector,
    { timeout }
  );
}
