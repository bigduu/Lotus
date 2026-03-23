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
    it("should return zh-CN locale for zh-CN", () => {
      const locale = getAntdLocale("zh-CN");
      expect(locale).toBe(zhCN);
    });

    it("should return zh-TW locale for zh-TW", () => {
      const locale = getAntdLocale("zh-TW");
      expect(locale).toBe(zhTW);
    });

    it("should return fr-FR locale for fr-FR", () => {
      const locale = getAntdLocale("fr-FR");
      expect(locale).toBe(frFR);
    });

    it("should return ja-JP locale for ja-JP", () => {
      const locale = getAntdLocale("ja-JP");
      expect(locale).toBe(jaJP);
    });

    it("should return hi-IN locale for hi-IN", () => {
      const locale = getAntdLocale("hi-IN");
      expect(locale).toBe(hiIN);
    });

    it("should return en-US locale for en-US (default)", () => {
      const locale = getAntdLocale("en-US");
      expect(locale).toBe(enUS);
    });

    it("should return en-US locale for unknown locale via default case", () => {
      const locale = getAntdLocale("es-ES" as AppLocale);
      expect(locale).toBe(enUS);
    });

    it("should return different locales for different inputs", () => {
      const zhCN = getAntdLocale("zh-CN");
      const zhTW = getAntdLocale("zh-TW");
      const enUS = getAntdLocale("en-US");
      const frFR = getAntdLocale("fr-FR");
      const jaJP = getAntdLocale("ja-JP");
      const hiIN = getAntdLocale("hi-IN");

      // They should be different objects
      expect(zhCN).not.toBe(zhTW);
      expect(zhCN).not.toBe(enUS);
      expect(enUS).not.toBe(frFR);
      expect(frFR).not.toBe(jaJP);
      expect(jaJP).not.toBe(hiIN);
    });

    it("should return locale with required properties", () => {
      const locales: AppLocale[] = [
        "zh-CN",
        "zh-TW",
        "en-US",
        "fr-FR",
        "ja-JP",
        "hi-IN",
      ];

      locales.forEach((localeCode) => {
        const locale = getAntdLocale(localeCode);
        expect(typeof locale).toBe("object");
        expect(locale).toHaveProperty("locale");
        expect(locale).toBe(localeMap[localeCode]);
      });
    });

    it("should handle all supported locales", () => {
      const supportedLocales: AppLocale[] = [
        "en-US",
        "zh-CN",
        "zh-TW",
        "fr-FR",
        "ja-JP",
        "hi-IN",
      ];

      supportedLocales.forEach((locale) => {
        expect(getAntdLocale(locale)).toBe(localeMap[locale]);
      });
    });

    it("should return consistent results for same input", () => {
      const locale1 = getAntdLocale("zh-CN");
      const locale2 = getAntdLocale("zh-CN");
      // Note: These might not be the same object instance, but should be equivalent
      expect(locale1).toEqual(locale2);
    });

    it("should return default en-US for default case branch", () => {
      const enUS = getAntdLocale("en-US");
      expect(enUS).toBe(localeMap["en-US"]);
    });
  });
});
