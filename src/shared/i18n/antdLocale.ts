import type { Locale } from "antd/es/locale";
import type { AppLocale } from "./types";

// antd locale bundles are ~200 KB+ combined. Load them lazily so the default
// (en-US) path keeps them off the first-paint critical path, and only the
// selected locale is ever fetched. Memoized per locale.
const localeLoaders: Partial<Record<AppLocale, () => Promise<{ default: Locale }>>> = {
  "zh-CN": () => import("antd/locale/zh_CN"),
  "zh-TW": () => import("antd/locale/zh_TW"),
  "fr-FR": () => import("antd/locale/fr_FR"),
  "ja-JP": () => import("antd/locale/ja_JP"),
  "hi-IN": () => import("antd/locale/hi_IN"),
  "en-US": () => import("antd/locale/en_US"),
};

const localeCache = new Map<AppLocale, Locale>();

/**
 * Resolve the antd locale for the active app locale, loading it on demand.
 * Falls back to the en-US bundle (which ships with antd) when an unmapped
 * locale is requested.
 */
export const getAntdLocale = async (locale: AppLocale): Promise<Locale> => {
  const cached = localeCache.get(locale);
  if (cached) return cached;

  const loader = localeLoaders[locale] ?? localeLoaders["en-US"];
  if (!loader) {
    // Should be unreachable (en-US is always present), but stay type-safe.
    throw new Error(`No antd locale loader for ${locale}`);
  }

  const mod = await loader();
  const resolved = mod.default;
  localeCache.set(locale, resolved);
  return resolved;
};
