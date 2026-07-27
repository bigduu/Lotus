/**
 * Maps the app's explicit locale choice to a date-fns `Locale` (#168):
 * date formatting should follow the language the user selected in Settings,
 * not the browser's default locale.
 */
import { enUS } from "date-fns/locale/en-US";
import { zhCN } from "date-fns/locale/zh-CN";
import { zhTW } from "date-fns/locale/zh-TW";
import { fr } from "date-fns/locale/fr";
import { ja } from "date-fns/locale/ja";
import { hi } from "date-fns/locale/hi";
import type { Locale } from "date-fns";

import i18n from "./index";
import type { AppLocale } from "./types";
import { DEFAULT_APP_LOCALE, isSupportedAppLocale } from "./types";

const DATE_FNS_LOCALE_BY_APP_LOCALE: Record<AppLocale, Locale> = {
  "en-US": enUS,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  "fr-FR": fr,
  "ja-JP": ja,
  "hi-IN": hi,
};

export const getDateFnsLocale = (appLocale: AppLocale): Locale =>
  DATE_FNS_LOCALE_BY_APP_LOCALE[appLocale] ?? enUS;

/** date-fns locale for the currently active app locale. */
export const getActiveDateFnsLocale = (): Locale => {
  const active = i18n.language;
  return getDateFnsLocale(isSupportedAppLocale(active) ? active : DEFAULT_APP_LOCALE);
};

/** BCP-47 tag of the active app locale, for `Date#toLocaleString` etc. */
export const getActiveLocaleTag = (): string =>
  isSupportedAppLocale(i18n.language) ? i18n.language : DEFAULT_APP_LOCALE;
