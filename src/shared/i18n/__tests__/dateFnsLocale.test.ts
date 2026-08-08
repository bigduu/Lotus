import { afterEach, describe, expect, it } from "vitest";

import { formatAgendaTime } from "@shared/components/LedgerDrawer/logic";
import { changeLocale } from "@shared/i18n";
import {
  getActiveAppLocale,
  getActiveDateFnsLocale,
  getActiveLocaleTag,
  getDateFnsLocale,
  resolveAppLocale,
} from "@shared/i18n/dateFnsLocale";
import { SUPPORTED_APP_LOCALES } from "@shared/i18n/types";

describe("date localization follows the app locale (#168)", () => {
  afterEach(async () => {
    await changeLocale("en-US");
  });

  it("maps every supported AppLocale to a date-fns locale", () => {
    for (const appLocale of SUPPORTED_APP_LOCALES) {
      expect(getDateFnsLocale(appLocale).code).toBeTruthy();
    }
    expect(getDateFnsLocale("fr-FR").code).toBe("fr");
    expect(getDateFnsLocale("ja-JP").code).toBe("ja");
  });

  it("tracks the active application locale", async () => {
    await changeLocale("zh-CN");
    expect(getActiveAppLocale()).toBe("zh-CN");
    expect(getActiveLocaleTag()).toBe("zh-CN");

    await changeLocale("fr-FR");
    expect(getActiveAppLocale()).toBe("fr-FR");
    expect(getActiveLocaleTag()).toBe("fr-FR");
  });

  it("localizes Ledger month names with the application locale", async () => {
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

  it("falls back to en-US for a stale unsupported i18n language", () => {
    expect(resolveAppLocale("klingon")).toBe("en-US");
    expect(resolveAppLocale(undefined)).toBe("en-US");
  });
});
