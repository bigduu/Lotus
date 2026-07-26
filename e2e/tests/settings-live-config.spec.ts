import { expect, test, type Page } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { openSettingsPage, openSettingsTab } from "../utils/test-helpers";

type SectionEnvelope = {
  schema_version: number;
  revision: number;
  data: Record<string, unknown>;
};

const dataDir = process.env.E2E_DATA_DIR ?? "/tmp/test-data";
const sectionPath = (section: string) => path.join(dataDir, `${section}.json`);

const readSection = async (section: string): Promise<SectionEnvelope> =>
  JSON.parse(await fs.readFile(sectionPath(section), "utf8")) as SectionEnvelope;

const publishSection = async (
  section: string,
  mutate: (data: Record<string, unknown>) => Record<string, unknown>,
): Promise<SectionEnvelope> => {
  const current = await readSection(section);
  const next = {
    ...current,
    revision: current.revision + 1,
    data: mutate(structuredClone(current.data)),
  };
  const target = sectionPath(section);
  await fs.writeFile(target, `${JSON.stringify(next, null, 2)}\n`);
  return next;
};

const restoreSection = async (section: string, original: SectionEnvelope): Promise<void> => {
  let currentRevision = original.revision;
  try {
    currentRevision = (await readSection(section)).revision;
  } catch {
    currentRevision += 1;
  }
  const restored = {
    ...original,
    revision: Math.max(currentRevision, original.revision) + 1,
  };
  const target = sectionPath(section);
  await fs.writeFile(target, `${JSON.stringify(restored, null, 2)}\n`);
};

const openConfigTab = async (page: Page): Promise<void> => {
  await openSettingsPage(page);
  await openSettingsTab(page, "config");
  await expect(page.locator('[data-testid="proxy-url"]')).toBeVisible();
};

test.describe.serial("Live versioned settings", () => {
  test("keeps dirty edits, rebases them over an external file change, and refreshes clean drafts", async ({
    page,
  }) => {
    const original = await readSection("core");
    try {
      await openConfigTab(page);
      const localHttpProxy = "http://127.0.0.1:8111";
      const externalHttpsProxy = "http://127.0.0.1:8222";
      await page.locator('[data-testid="proxy-url"]').fill(localHttpProxy);

      await publishSection("core", (data) => ({
        ...data,
        https_proxy: externalHttpsProxy,
      }));

      await expect(page.getByText("Configuration changed on disk", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.locator('[data-testid="proxy-url"]')).toHaveValue(localHttpProxy);
      await page.getByRole("button", { name: "Reapply", exact: true }).click();
      await expect(page.locator('[data-testid="https-proxy-url"]')).toHaveValue(externalHttpsProxy);

      const saveResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === "PUT" &&
          response.url().includes("/bamboo/config/sections/core"),
      );
      await page.locator('[data-testid="save-proxy-settings"]').click();
      expect((await saveResponsePromise).status()).toBe(200);
      await expect
        .poll(async () => (await readSection("core")).data.http_proxy)
        .toBe(localHttpProxy);
      await expect
        .poll(async () => (await readSection("core")).data.https_proxy)
        .toBe(externalHttpsProxy);

      const cleanExternalProxy = "http://127.0.0.1:8333";
      await publishSection("core", (data) => ({
        ...data,
        http_proxy: cleanExternalProxy,
      }));
      await expect(page.locator('[data-testid="proxy-url"]')).toHaveValue(cleanExternalProxy, {
        timeout: 15_000,
      });
      await expect(page.getByText("Configuration changed on disk", { exact: true })).toBeHidden();
    } finally {
      await restoreSection("core", original);
    }
  });

  test("preserves the last healthy snapshot across invalid and recovered external edits", async ({
    page,
  }) => {
    const original = await readSection("model-policy");
    const target = sectionPath("model-policy");
    try {
      await openSettingsPage(page);
      await openSettingsTab(page, "masking");
      await expect(page.locator('[data-testid="add-keyword"]')).toBeVisible();

      await fs.writeFile(target, "{ invalid json\n");

      await expect(page.getByText("model-policy configuration invalid")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.locator('[data-testid="add-keyword"]')).toBeVisible();

      await restoreSection("model-policy", original);
      await expect(page.getByText(/model-policy: healthy/)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("model-policy configuration invalid")).toBeHidden();
    } finally {
      await restoreSection("model-policy", original);
    }
  });

  test("two clients get a real 409 before the stale draft can be reapplied", async ({
    browser,
  }) => {
    const original = await readSection("core");
    const context = await browser.newContext();
    const first = await context.newPage();
    const second = await context.newPage();
    try {
      await Promise.all([openConfigTab(first), openConfigTab(second)]);
      const firstValue = "http://127.0.0.1:8444";
      const secondValue = "http://127.0.0.1:8555";
      await first.locator('[data-testid="proxy-url"]').fill(firstValue);
      await second.locator('[data-testid="proxy-url"]').fill(secondValue);

      const firstSave = first.waitForResponse(
        (response) =>
          response.request().method() === "PUT" &&
          response.url().includes("/bamboo/config/sections/core"),
      );
      await first.locator('[data-testid="save-proxy-settings"]').click();
      expect((await firstSave).status()).toBe(200);

      await expect(second.getByText("Configuration changed on disk", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await expect(second.locator('[data-testid="proxy-url"]')).toHaveValue(secondValue);

      const staleSave = second.waitForResponse(
        (response) =>
          response.request().method() === "PUT" &&
          response.url().includes("/bamboo/config/sections/core"),
      );
      await second.locator('[data-testid="save-proxy-settings"]').click();
      expect((await staleSave).status()).toBe(409);
      await expect(second.locator('[data-testid="proxy-url"]')).toHaveValue(secondValue);

      await second.getByRole("button", { name: "Reapply", exact: true }).click();
      const rebasedSave = second.waitForResponse(
        (response) =>
          response.request().method() === "PUT" &&
          response.url().includes("/bamboo/config/sections/core"),
      );
      await second.locator('[data-testid="save-proxy-settings"]').click();
      expect((await rebasedSave).status()).toBe(200);
      await expect.poll(async () => (await readSection("core")).data.http_proxy).toBe(secondValue);
    } finally {
      await context.close();
      await restoreSection("core", original);
    }
  });

  test("proxy credential replace and clear never echo plaintext into responses or browser state", async ({
    page,
  }) => {
    await openConfigTab(page);
    const clearButton = page.locator('[data-testid="proxy-auth-clear"]');
    if (await clearButton.isVisible().catch(() => false)) {
      await clearButton.click();
      await expect(page.locator('[data-testid="proxy-auth-username"]')).toBeVisible();
    }

    const secret = `lotus-e2e-secret-${Date.now()}`;
    await page.locator('[data-testid="proxy-auth-username"]').fill("lotus-e2e");
    await page.locator('[data-testid="proxy-auth-password"]').fill(secret);
    const replaceResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && response.url().endsWith("/bamboo/proxy-auth"),
    );
    await page.locator('[data-testid="proxy-auth-apply"]').click();
    const replaceResponse = await replaceResponsePromise;
    expect(replaceResponse.status()).toBe(200);
    expect(await replaceResponse.text()).not.toContain(secret);
    await expect(clearButton).toBeVisible();

    const browserState = await page.evaluate(() =>
      JSON.stringify({
        localStorage: { ...localStorage },
        sessionStorage: { ...sessionStorage },
        body: document.body.textContent,
      }),
    );
    expect(browserState).not.toContain(secret);
    expect(await fs.readFile(sectionPath("core"), "utf8")).not.toContain(secret);
    expect(await fs.readFile(path.join(dataDir, "credentials.json"), "utf8")).not.toContain(secret);

    const clearResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && response.url().endsWith("/bamboo/proxy-auth"),
    );
    await clearButton.click();
    const clearResponse = await clearResponsePromise;
    expect(clearResponse.status()).toBe(200);
    expect(await clearResponse.text()).not.toContain(secret);
    await expect(page.locator('[data-testid="proxy-auth-username"]')).toBeVisible();
  });
});
