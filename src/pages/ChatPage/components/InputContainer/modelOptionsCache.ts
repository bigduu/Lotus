import { type ProviderType } from "@shared/types/providerConfig";
import { StorageManager } from "@services/storage/StorageManager";
import { MODEL_OPTIONS_CACHE_PREFIX, MODEL_OPTIONS_CACHE_TTL_MS } from "./constants";
import type { ModelCachePayload, ModelOption } from "./types";

export const getModelOptionsCacheKey = (provider: ProviderType) =>
  `${MODEL_OPTIONS_CACHE_PREFIX}:${provider}`;

// localStorage helpers for model options cache
export const readModelOptionsCacheFromLocalStorage = (
  provider: ProviderType,
): ModelOption[] | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(getModelOptionsCacheKey(provider));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ModelCachePayload;
    if (!parsed || !Array.isArray(parsed.options)) return null;
    if (Date.now() - parsed.timestamp > MODEL_OPTIONS_CACHE_TTL_MS) return null;
    return parsed.options
      .filter(
        (item) =>
          item &&
          typeof item.value === "string" &&
          item.value.trim().length > 0 &&
          typeof item.label === "string",
      )
      .map((item) => ({ value: item.value, label: item.label }));
  } catch {
    return null;
  }
};

export const writeModelOptionsCacheToLocalStorage = (
  provider: ProviderType,
  options: ModelOption[],
): void => {
  if (typeof window === "undefined") return;
  try {
    const payload: ModelCachePayload = {
      timestamp: Date.now(),
      options,
    };
    localStorage.setItem(getModelOptionsCacheKey(provider), JSON.stringify(payload));
  } catch {
    // Ignore cache write failures.
  }
};

export const readModelOptionsCache = async (
  provider: ProviderType,
): Promise<ModelOption[] | null> => {
  const manager = StorageManager.getInstance();
  try {
    const cached = await manager.loadModelOptionsCache(provider);
    if (cached) {
      if (Date.now() - cached.timestamp > MODEL_OPTIONS_CACHE_TTL_MS) return null;
      return cached.options.filter(
        (item) =>
          item &&
          typeof item.value === "string" &&
          item.value.trim().length > 0 &&
          typeof item.label === "string",
      );
    }
  } catch {
    // Fall through to localStorage
  }
  // Fallback to localStorage if IndexedDB is unavailable
  return readModelOptionsCacheFromLocalStorage(provider);
};

export const writeModelOptionsCache = async (
  provider: ProviderType,
  options: ModelOption[],
): Promise<void> => {
  const manager = StorageManager.getInstance();
  try {
    await manager.saveModelOptionsCache(provider, options, Date.now());
  } catch {
    // Ignore IndexedDB write failures
  }
  // Also keep writing to localStorage for backward compatibility
  writeModelOptionsCacheToLocalStorage(provider, options);
};
