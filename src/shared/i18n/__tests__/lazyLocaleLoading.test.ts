import { describe, expect, it } from "vitest";
import i18n, { changeLocale } from "../index";
import type { AppLocale } from "../types";

describe("i18n lazy locale loading", () => {
  describe("changeLocale", () => {
    it("should load en-US (base) resources and change language", async () => {
      await changeLocale("en-US");
      expect(i18n.language).toBe("en-US");
      expect(i18n.hasResourceBundle("en-US", "translation")).toBe(true);
    });

    it("should load zh-CN (base) resources and change language", async () => {
      await changeLocale("zh-CN");
      expect(i18n.language).toBe("zh-CN");
      expect(i18n.hasResourceBundle("zh-CN", "translation")).toBe(true);
    });

    it("should lazily load fr-FR resources on first switch", async () => {
      await changeLocale("fr-FR");
      expect(i18n.language).toBe("fr-FR");
      expect(i18n.hasResourceBundle("fr-FR", "translation")).toBe(true);

      // Verify a known French key is present
      const t = i18n.getFixedT("fr-FR");
      expect(t("app.loading")).toBe("Chargement...");
    });

    it("should lazily load ja-JP resources on first switch", async () => {
      await changeLocale("ja-JP");
      expect(i18n.language).toBe("ja-JP");
      expect(i18n.hasResourceBundle("ja-JP", "translation")).toBe(true);

      const t = i18n.getFixedT("ja-JP");
      expect(t("app.loading")).toBe("読み込み中...");
    });

    it("should lazily load hi-IN resources on first switch", async () => {
      await changeLocale("hi-IN");
      expect(i18n.language).toBe("hi-IN");
      expect(i18n.hasResourceBundle("hi-IN", "translation")).toBe(true);

      const t = i18n.getFixedT("hi-IN");
      expect(t("app.loading")).toBe("लोड हो रहा है...");
    });

    it("should lazily load zh-TW resources on first switch", async () => {
      await changeLocale("zh-TW");
      expect(i18n.language).toBe("zh-TW");
      expect(i18n.hasResourceBundle("zh-TW", "translation")).toBe(true);

      const t = i18n.getFixedT("zh-TW");
      expect(t("app.loading")).toBe("載入中...");
    });

    it("should reuse cached resources on second switch to same locale", async () => {
      await changeLocale("fr-FR");
      expect(i18n.hasResourceBundle("fr-FR", "translation")).toBe(true);

      // Switch away then back
      await changeLocale("en-US");
      await changeLocale("fr-FR");
      expect(i18n.language).toBe("fr-FR");
    });

    it("should return the correct translations for all locales", async () => {
      const checks: Array<{ locale: AppLocale; key: string; expected: string }> = [
        { locale: "en-US", key: "app.loading", expected: "Loading..." },
        { locale: "zh-CN", key: "app.loading", expected: "加载中..." },
        { locale: "zh-TW", key: "app.loading", expected: "載入中..." },
        { locale: "fr-FR", key: "app.loading", expected: "Chargement..." },
        { locale: "ja-JP", key: "app.loading", expected: "読み込み中..." },
        { locale: "hi-IN", key: "app.loading", expected: "लोड हो रहा है..." },
      ];

      for (const { locale, key, expected } of checks) {
        await changeLocale(locale);
        expect(i18n.t(key)).toBe(expected);
      }
    });
  });
});
