export type BaseLocale = "en-US" | "zh-CN";

export type EnUsTranslation = typeof import("./resources/en-US").enUsTranslation;
export type ZhCnTranslation = typeof import("./resources/zh-CN").zhCnTranslation;
type BaseTranslationResource = EnUsTranslation | ZhCnTranslation;

const baseResourceLoaders = {
  "en-US": () => import("./resources/en-US").then(({ enUsTranslation }) => enUsTranslation),
  "zh-CN": () => import("./resources/zh-CN").then(({ zhCnTranslation }) => zhCnTranslation),
} as const;

const baseResourceCache = new Map<BaseLocale, Promise<BaseTranslationResource>>();

export const loadBaseResource = <T extends BaseLocale>(locale: T) => {
  let promise = baseResourceCache.get(locale);
  if (!promise) {
    promise = baseResourceLoaders[locale]();
    baseResourceCache.set(locale, promise);
  }

  return promise as Promise<T extends "en-US" ? EnUsTranslation : ZhCnTranslation>;
};
