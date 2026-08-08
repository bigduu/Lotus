/**
 * Date formatting must follow the language selected inside Lotus rather than
 * the browser or operating-system locale (#168).
 */
import type { Locale } from "date-fns";
import { enUS } from "date-fns/locale/en-US";
import { fr } from "date-fns/locale/fr";
import { hi } from "date-fns/locale/hi";
import { ja } from "date-fns/locale/ja";
import { zhCN } from "date-fns/locale/zh-CN";
import { zhTW } from "date-fns/locale/zh-TW";

import i18n from "./index";
import { DEFAULT_APP_LOCALE, isSupportedAppLocale, type AppLocale } from "./types";

const DATE_FNS_LOCALE_BY_APP_LOCALE: Record<AppLocale, Locale> = {
  "en-US": enUS,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  "fr-FR": fr,
  "ja-JP": ja,
  "hi-IN": hi,
};

export const getDateFnsLocale = (appLocale: AppLocale): Locale =>
  DATE_FNS_LOCALE_BY_APP_LOCALE[appLocale];

export const resolveAppLocale = (locale: string | undefined): AppLocale =>
  locale && isSupportedAppLocale(locale) ? locale : DEFAULT_APP_LOCALE;

export const getActiveAppLocale = (): AppLocale => {
  const activeLocale = i18n.resolvedLanguage ?? i18n.language;
  return resolveAppLocale(activeLocale);
};

/** BCP-47 tag for `Intl` and `Date#toLocaleString`. */
export const getActiveLocaleTag = (): AppLocale => getActiveAppLocale();

export const getActiveDateFnsLocale = (): Locale => getDateFnsLocale(getActiveAppLocale());
