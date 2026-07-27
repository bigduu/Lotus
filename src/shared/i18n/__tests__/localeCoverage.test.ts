/**
 * Locale coverage telemetry + regression floor (#168).
 *
 * Derived locales (fr/ja/hi/zh-TW) are built as "base language + override
 * subset", so any key without an override silently falls back to the base
 * (English; zh-CN for zh-TW). This test makes the gap visible in CI output
 * and locks the CURRENT translated-key counts as a floor — coverage may
 * improve but must never regress.
 */
import { describe, expect, it } from "vitest";

import i18n, { changeLocale } from "@shared/i18n";
import { enUsTranslation } from "@shared/i18n/resources/en-US";
import { zhCnTranslation } from "@shared/i18n/resources/zh-CN";

const flatten = (obj: unknown, prefix = ""): Record<string, string> => {
  const out: Record<string, string> = {};
  if (typeof obj === "string") {
    out[prefix] = obj;
    return out;
  }
  if (obj && typeof obj === "object") {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      Object.assign(out, flatten(value, prefix ? `${prefix}.${key}` : key));
    }
  }
  return out;
};

const DERIVED_LOCALES = [
  { locale: "fr-FR", floor: 1165 },
  { locale: "ja-JP", floor: 741 },
  { locale: "hi-IN", floor: 1142 },
  { locale: "zh-TW", floor: 816 },
] as const;

describe("locale coverage (#168)", () => {
  it("reports per-locale coverage and never drops below the floor", async () => {
    const en = flatten(enUsTranslation.translation);
    const zhCn = flatten(zhCnTranslation.translation);

    const report: Record<string, string> = {};
    for (const { locale, floor } of DERIVED_LOCALES) {
      await changeLocale(locale);
      const bundle = i18n.getResourceBundle(locale, "translation");
      const flat = flatten(bundle);
      const base = locale === "zh-TW" ? zhCn : en;
      const keys = Object.keys(base);
      const translated = keys.filter(
        (key) => flat[key] !== undefined && flat[key] !== base[key],
      ).length;

      report[locale] =
        `${translated}/${keys.length} (${((translated / keys.length) * 100).toFixed(1)}%)`;
      expect(
        translated,
        `${locale} translated-key count regressed below the ${floor} floor`,
      ).toBeGreaterThanOrEqual(floor);
    }

    // Visible in CI logs: the current translation gap per locale.
    console.log("[i18n coverage]", JSON.stringify(report, null, 2));

    await changeLocale("en-US");
  });
});
