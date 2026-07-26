import { describe, expect, it } from "vitest";
import { getAntdLocale } from "../antdLocale";
import type { AppLocale } from "../types";
import enUS from "antd/locale/en_US";
import frFR from "antd/locale/fr_FR";
import hiIN from "antd/locale/hi_IN";
import jaJP from "antd/locale/ja_JP";
import zhCN from "antd/locale/zh_CN";
import zhTW from "antd/locale/zh_TW";

describe("antdLocale", () => {
  const localeMap: Record<AppLocale, typeof enUS> = {
    "en-US": enUS,
    "zh-CN": zhCN,
    "zh-TW": zhTW,
    "fr-FR": frFR,
    "ja-JP": jaJP,
    "hi-IN": hiIN,
  };

  describe("getAntdLocale", () => {
    it("should return zh-CN locale for zh-CN", async () => {
      const locale = await getAntdLocale("zh-CN");
      expect(locale).toBe(zhCN);
    });

    it("should return zh-TW locale for zh-TW", async () => {
      const locale = await getAntdLocale("zh-TW");
      expect(locale).toBe(zhTW);
    });

    it("should return fr-FR locale for fr-FR", async () => {
      const locale = await getAntdLocale("fr-FR");
      expect(locale).toBe(frFR);
    });

    it("should return ja-JP locale for ja-JP", async () => {
      const locale = await getAntdLocale("ja-JP");
      expect(locale).toBe(jaJP);
    });

    it("should return hi-IN locale for hi-IN", async () => {
      const locale = await getAntdLocale("hi-IN");
      expect(locale).toBe(hiIN);
    });

    it("should return en-US locale for en-US (default)", async () => {
      const locale = await getAntdLocale("en-US");
      expect(locale).toBe(enUS);
    });

    it("should return en-US locale for unknown locale via default fallback", async () => {
      const locale = await getAntdLocale("es-ES" as AppLocale);
      expect(locale).toBe(enUS);
    });

    it("should return different locales for different inputs", async () => {
      const zhCNLocale = await getAntdLocale("zh-CN");
      const zhTWLocale = await getAntdLocale("zh-TW");
      const enUSLocale = await getAntdLocale("en-US");
      const frFRLocale = await getAntdLocale("fr-FR");
      const jaJPLocale = await getAntdLocale("ja-JP");
      const hiINLocale = await getAntdLocale("hi-IN");

      // They should be different objects
      expect(zhCNLocale).not.toBe(zhTWLocale);
      expect(zhCNLocale).not.toBe(enUSLocale);
      expect(enUSLocale).not.toBe(frFRLocale);
      expect(frFRLocale).not.toBe(jaJPLocale);
      expect(jaJPLocale).not.toBe(hiINLocale);
    });

    it("should return locale with required properties", async () => {
      const locales: AppLocale[] = ["zh-CN", "zh-TW", "en-US", "fr-FR", "ja-JP", "hi-IN"];

      for (const localeCode of locales) {
        const locale = await getAntdLocale(localeCode);
        expect(typeof locale).toBe("object");
        expect(locale).toHaveProperty("locale");
        expect(locale).toBe(localeMap[localeCode]);
      }
    });

    it("should handle all supported locales", async () => {
      const supportedLocales: AppLocale[] = ["en-US", "zh-CN", "zh-TW", "fr-FR", "ja-JP", "hi-IN"];

      for (const locale of supportedLocales) {
        expect(await getAntdLocale(locale)).toBe(localeMap[locale]);
      }
    });

    it("should return consistent results for same input", async () => {
      const locale1 = await getAntdLocale("zh-CN");
      const locale2 = await getAntdLocale("zh-CN");
      // Cached, so the same object instance.
      expect(locale1).toBe(locale2);
    });

    it("should return default en-US for en-US", async () => {
      const result = await getAntdLocale("en-US");
      expect(result).toBe(localeMap["en-US"]);
    });
  });
});
