export type AppLocale = "en-US" | "zh-CN" | "zh-TW" | "fr-FR" | "ja-JP" | "hi-IN";

export const APP_LOCALE_STORAGE_KEY = "lotus_ui_locale_v1";
export const DEFAULT_APP_LOCALE: AppLocale = "en-US";
export const SUPPORTED_APP_LOCALES: AppLocale[] = [
  "en-US",
  "zh-CN",
  "zh-TW",
  "fr-FR",
  "ja-JP",
  "hi-IN",
];

export const isSupportedAppLocale = (value: string | null | undefined): value is AppLocale => {
  if (!value) {
    return false;
  }

  return SUPPORTED_APP_LOCALES.includes(value as AppLocale);
};

export const resolveInitialLocale = (): AppLocale => {
  if (typeof window === "undefined") {
    return DEFAULT_APP_LOCALE;
  }

  try {
    const localStorageRef = window.localStorage as Partial<Storage> | undefined;
    const savedLocale =
      localStorageRef && typeof localStorageRef.getItem === "function"
        ? localStorageRef.getItem(APP_LOCALE_STORAGE_KEY)
        : null;

    if (isSupportedAppLocale(savedLocale)) {
      return savedLocale;
    }
  } catch {
    // Ignore storage read failures and continue with browser locale fallback.
  }

  const browserLocale = window.navigator.language?.toLowerCase() ?? "";
  if (browserLocale.startsWith("zh")) {
    if (
      browserLocale.includes("tw") ||
      browserLocale.includes("hk") ||
      browserLocale.includes("mo") ||
      browserLocale.includes("hant")
    ) {
      return "zh-TW";
    }
    return "zh-CN";
  }
  if (browserLocale.startsWith("fr")) {
    return "fr-FR";
  }
  if (browserLocale.startsWith("ja")) {
    return "ja-JP";
  }
  if (browserLocale.startsWith("hi")) {
    return "hi-IN";
  }

  return DEFAULT_APP_LOCALE;
};
