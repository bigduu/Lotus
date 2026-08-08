/**
 * Derived locales are built as a base language plus an override subset. Make
 * inherited strings visible in CI and fail when translation coverage regresses
 * (#168). High-traffic surfaces also carry explicit translated-key guards.
 */
import { afterAll, describe, expect, it } from "vitest";

import i18n, { changeLocale } from "@shared/i18n";
import { enUsTranslation } from "@shared/i18n/resources/en-US";
import { zhCnTranslation } from "@shared/i18n/resources/zh-CN";

type DerivedLocale = "fr-FR" | "ja-JP" | "hi-IN" | "zh-TW";

const HIGH_TRAFFIC_NAMESPACES = ["chat", "app.errorBoundary", "components.approval"] as const;

type CoverageFloor = {
  locale: DerivedLocale;
  total: number;
  namespaces: Record<(typeof HIGH_TRAFFIC_NAMESPACES)[number], number>;
};

const COVERAGE_FLOORS: CoverageFloor[] = [
  {
    locale: "fr-FR",
    total: 1175,
    namespaces: { chat: 176, "app.errorBoundary": 5, "components.approval": 12 },
  },
  {
    locale: "ja-JP",
    total: 754,
    namespaces: { chat: 123, "app.errorBoundary": 5, "components.approval": 12 },
  },
  {
    locale: "hi-IN",
    total: 1152,
    namespaces: { chat: 172, "app.errorBoundary": 5, "components.approval": 12 },
  },
  {
    locale: "zh-TW",
    total: 829,
    namespaces: { chat: 132, "app.errorBoundary": 5, "components.approval": 12 },
  },
];

// Some translated values are intentionally identical in both languages. Keep
// the exception explicit so it is reviewed instead of silently counted as a
// fallback. This key is also explicitly overridden by buildZhTwTranslation.
const REVIEWED_IDENTICAL_TRANSLATIONS: Partial<Record<DerivedLocale, ReadonlySet<string>>> = {
  "zh-TW": new Set(["components.approval.toolName"]),
};

const CRITICAL_HIGH_TRAFFIC_KEYS = [
  "chat.sidebar.newSession",
  "chat.sidebar.empty.noSessions",
  "chat.input.placeholder",
  "chat.actions.sendMessage",
  "chat.streaming.sendFailed",
  "app.notifications.toolApproval.genericTitle",
  "app.errorBoundary.title",
  "app.errorBoundary.description",
  "app.errorBoundary.tryAgain",
  "app.errorBoundary.showDetails",
  "app.errorBoundary.hideDetails",
  "components.approval.workflow",
  "components.approval.executionRequest",
  "components.approval.aiWantsExecute",
  "components.approval.childTitle",
  "components.approval.childQuestion",
  "components.approval.approve",
  "components.approval.deny",
  "components.approval.toolName",
  "components.approval.permission",
  "components.approval.target",
  "components.approval.childGone",
  "components.approval.deliverFailed",
] as const;

const flattenStrings = (value: unknown, prefix = ""): Record<string, string> => {
  if (typeof value === "string") {
    return { [prefix]: value };
  }

  const flattened: Record<string, string> = {};
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      Object.assign(flattened, flattenStrings(child, prefix ? `${prefix}.${key}` : key));
    }
  }
  return flattened;
};

const countTranslatedKeys = (
  locale: DerivedLocale,
  base: Record<string, string>,
  derived: Record<string, string>,
  namespace?: string,
) => {
  const prefix = namespace ? `${namespace}.` : "";
  const keys = Object.keys(base).filter(
    (key) => !namespace || key === namespace || key.startsWith(prefix),
  );
  const translated = keys.filter(
    (key) =>
      derived[key] !== undefined &&
      (derived[key] !== base[key] || REVIEWED_IDENTICAL_TRANSLATIONS[locale]?.has(key)),
  ).length;
  return { translated, total: keys.length };
};

describe("derived locale coverage (#168)", () => {
  afterAll(async () => {
    await changeLocale("en-US");
  });

  it("reports coverage and prevents total translated-key regression", async () => {
    const en = flattenStrings(enUsTranslation.translation);
    const zhCn = flattenStrings(zhCnTranslation.translation);
    const report: Record<string, Record<string, string>> = {};

    for (const { locale, total: floor, namespaces: namespaceFloors } of COVERAGE_FLOORS) {
      await changeLocale(locale);
      const derived = flattenStrings(i18n.getResourceBundle(locale, "translation"));
      const base = locale === "zh-TW" ? zhCn : en;
      const overall = countTranslatedKeys(locale, base, derived);
      const namespaces = Object.fromEntries(
        HIGH_TRAFFIC_NAMESPACES.map((namespace) => {
          const coverage = countTranslatedKeys(locale, base, derived, namespace);
          expect(
            coverage.translated,
            `${locale} ${namespace} translated-key coverage regressed`,
          ).toBeGreaterThanOrEqual(namespaceFloors[namespace]);
          return [
            namespace,
            `${coverage.translated}/${coverage.total} (${(
              (coverage.translated / coverage.total) *
              100
            ).toFixed(1)}%)`,
          ];
        }),
      );

      report[locale] = {
        total: `${overall.translated}/${overall.total} (${(
          (overall.translated / overall.total) *
          100
        ).toFixed(1)}%)`,
        ...namespaces,
      };
      expect(
        overall.translated,
        `${locale} translated-key coverage regressed`,
      ).toBeGreaterThanOrEqual(floor);
    }

    console.info("[i18n coverage]", JSON.stringify(report, null, 2));
  });

  it("does not inherit base-language strings for critical high-traffic keys", async () => {
    const en = flattenStrings(enUsTranslation.translation);
    const zhCn = flattenStrings(zhCnTranslation.translation);
    const inherited: string[] = [];

    for (const { locale } of COVERAGE_FLOORS) {
      await changeLocale(locale);
      const derived = flattenStrings(i18n.getResourceBundle(locale, "translation"));
      const base = locale === "zh-TW" ? zhCn : en;
      for (const key of CRITICAL_HIGH_TRAFFIC_KEYS) {
        if (
          derived[key] === undefined ||
          (derived[key] === base[key] && !REVIEWED_IDENTICAL_TRANSLATIONS[locale]?.has(key))
        ) {
          inherited.push(`${locale}: ${key}`);
        }
      }
    }

    expect(
      inherited,
      `Critical translations still inherit their base-language value:\n${inherited.join("\n")}`,
    ).toEqual([]);
  });
});
