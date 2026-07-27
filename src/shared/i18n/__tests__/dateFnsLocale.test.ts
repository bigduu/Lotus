import { afterEach, describe, expect, it } from "vitest";

import { changeLocale } from "@shared/i18n";
import {
  getActiveDateFnsLocale,
  getActiveLocaleTag,
  getDateFnsLocale,
} from "@shared/i18n/dateFnsLocale";
import { formatAgendaTime } from "@shared/components/LedgerDrawer/logic";

describe("date localization follows the app locale (#168)", () => {
  afterEach(async () => {
    await changeLocale("en-US");
  });

  it("maps every AppLocale to a date-fns locale", () => {
    for (const appLocale of ["en-US", "zh-CN", "zh-TW", "fr-FR", "ja-JP", "hi-IN"] as const) {
      expect(getDateFnsLocale(appLocale).code).toBeTruthy();
    }
    expect(getDateFnsLocale("fr-FR").code).toBe("fr");
    expect(getDateFnsLocale("ja-JP").code).toBe("ja");
  });

  it("getActiveLocaleTag tracks the active app locale", async () => {
    await changeLocale("zh-CN");
    expect(getActiveLocaleTag()).toBe("zh-CN");
    await changeLocale("fr-FR");
    expect(getActiveLocaleTag()).toBe("fr-FR");
  });

  it("formatAgendaTime localizes month names per the app locale", async () => {
    const date = new Date(2026, 6, 26, 14, 30).toISOString();
    const now = new Date(2026, 11, 1, 12, 0);

    await changeLocale("en-US");
    expect(getActiveDateFnsLocale().code).toBe("en-US");
    expect(formatAgendaTime(date, now)).toContain("Jul");

    await changeLocale("zh-CN");
    expect(formatAgendaTime(date, now)).toContain("月");
    expect(formatAgendaTime(date, now)).not.toContain("Jul");

    await changeLocale("fr-FR");
    expect(formatAgendaTime(date, now)).toContain("juil.");
  });

  it("falls back to en-US for an unsupported active language", async () => {
    await changeLocale("en-US");
    const { default: i18n } = await import("@shared/i18n");
    const original = i18n.language;
    // Simulate a stale/unsupported language tag in the store.
    (i18n as { language: string }).language = "klingon";
    expect(getActiveLocaleTag()).toBe("en-US");
    (i18n as { language: string }).language = original;
  });
});
