/**
 * Vitest Setup File
 * Configures global mocks and test utilities
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { configure } from "@testing-library/react";

// testing-library's own `waitFor`/`findBy*` timeout (default 1000ms) is
// independent of vitest's `testTimeout` and was the dominant cause of
// spurious failures ("Unable to find an element", "expected mock to have
// been called") under CPU contention from full-suite parallel runs, even
// when the surrounding vitest test still had timeout budget left. See
// Lotus #78.
configure({ asyncUtilTimeout: 10000 });

const createMemoryStorage = (): Storage => {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear: () => {
      store.clear();
    },
    getItem: (key: string) => store.get(String(key)) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(String(key));
    },
    setItem: (key: string, value: string) => {
      store.set(String(key), String(value));
    },
  } as Storage;
};

// Some environments predefine a non-WebStorage `localStorage`.
const memoryLocalStorage = createMemoryStorage();
const memorySessionStorage = createMemoryStorage();

function installMemoryStorage(): void {
  Object.defineProperty(globalThis, "localStorage", {
    value: memoryLocalStorage,
    writable: true,
    configurable: true,
  });

  Object.defineProperty(globalThis, "sessionStorage", {
    value: memorySessionStorage,
    writable: true,
    configurable: true,
  });
}

installMemoryStorage();

// Re-install before every test in case jsdom or other setup overrides it.
beforeEach(() => {
  installMemoryStorage();
});

const { i18nReady } = await import("@shared/i18n");
await i18nReady;

// Always mock fetch to prevent network calls in tests
global.fetch = vi.fn();

// Mock Tauri API
(globalThis as any).__TAURI__ = {
  invoke: vi.fn(),
  event: {
    listen: vi.fn(),
    emit: vi.fn(),
  },
} as any;

if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return [];
  }
  unobserve() {}
} as any;

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
} as any;
