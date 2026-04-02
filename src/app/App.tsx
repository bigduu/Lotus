import { useEffect, useState } from "react";
import { App as AntdApp, Button, ConfigProvider as AntdConfigProvider, theme } from "antd";
import { useTranslation } from "react-i18next";
import "./App.css";
import "@shared/i18n";
import { MainLayout } from "./MainLayout";
import { ErrorBoundary } from "@shared/components/ErrorBoundary";
import { useThemeStore } from "@shared/store/themeStore";
import { SetupPage } from "../pages/SetupPage";
import { initializeStore } from "../pages/ChatPage/store";
import { ServiceFactory } from "../services/common/ServiceFactory";
import { getBackendBaseUrlSync } from "../shared/utils/backendBaseUrl";
import i18n from "@shared/i18n";
import { getAntdLocale } from "@shared/i18n/antdLocale";
import { APP_LOCALE_STORAGE_KEY, type AppLocale, resolveInitialLocale } from "@shared/i18n/types";
import { isVdiSafeModeEnabled } from "@shared/utils/vdiSafeMode";

const THEME_STORAGE_KEY = "copilot_ui_theme_v1";
const LIGHT_THEME_TOKEN = {
  // Brand primary — Bodhi teal (zen / nature)
  colorPrimary: "#0d9488",
  colorPrimaryHover: "#14b8a6",
  colorPrimaryActive: "#0f766e",
  colorInfo: "#0d9488",
  colorLink: "#0d9488",
  colorLinkHover: "#14b8a6",
  colorLinkActive: "#0f766e",
  colorSuccess: "#10b981",
  colorWarning: "#f59e0b",
  colorError: "#ef4444",

  // Text colors — calmer premium contrast
  colorText: "#0f172a",
  colorTextSecondary: "#475569",
  colorTextTertiary: "#64748b",
  colorTextDisabled: "#94a3b8",
  colorTextLightSolid: "#ffffff",

  // Borders
  colorBorder: "#d1e3e0",
  colorBorderSecondary: "#e2f0ee",

  // Fills & Backgrounds
  colorFill: "#f0fdfa",
  colorFillSecondary: "#f7fdfb",
  colorFillTertiary: "rgba(255, 255, 255, 0.82)",
  colorFillQuaternary: "transparent",
  colorBgLayout: "#f0fdfa",
  colorBgContainer: "rgba(255, 255, 255, 0.82)",
  colorBgElevated: "rgba(255, 255, 255, 0.9)",
  colorBgSpotlight: "rgba(13, 148, 136, 0.16)",
  colorPrimaryBg: "#f0fdfa",
  colorPrimaryBgHover: "#ccfbf1",
  colorPrimaryBorder: "#99f6e4",

  // Shape
  borderRadius: 10,
  borderRadiusLG: 18,
  borderRadiusSM: 10,

  // Shadows
  boxShadow: "0 12px 36px rgba(15, 118, 110, 0.10), 0 6px 18px rgba(15, 23, 42, 0.06)",
  boxShadowSecondary: "0 20px 48px rgba(15, 118, 110, 0.12), 0 8px 24px rgba(15, 23, 42, 0.08)",
};

const DARK_THEME_TOKEN = {
  // Brand primary — Bodhi teal for dark mode
  colorPrimary: "#2dd4bf",
  colorPrimaryHover: "#5eead4",
  colorPrimaryActive: "#0d9488",
  colorInfo: "#2dd4bf",
  colorLink: "#2dd4bf",
  colorLinkHover: "#5eead4",
  colorLinkActive: "#0d9488",
  colorSuccess: "#34d399",
  colorWarning: "#fbbf24",
  colorError: "#f87171",

  // Text colors for dark mode
  colorText: "#e5edf8",
  colorTextSecondary: "#b7c4d6",
  colorTextTertiary: "#8d9bb0",
  colorTextDisabled: "#627085",

  // Borders
  colorBorder: "rgba(255, 255, 255, 0.10)",
  colorBorderSecondary: "rgba(255, 255, 255, 0.06)",

  // Fills & Backgrounds
  colorFill: "#0c1a17",
  colorFillSecondary: "#091412",
  colorFillTertiary: "rgba(15, 23, 42, 0.74)",
  colorFillQuaternary: "transparent",
  colorBgLayout: "#070e0c",
  colorBgContainer: "rgba(11, 22, 18, 0.76)",
  colorBgElevated: "rgba(15, 30, 25, 0.9)",
  colorBgSpotlight: "rgba(13, 148, 136, 0.20)",
  colorPrimaryBg: "rgba(13, 148, 136, 0.14)",
  colorPrimaryBgHover: "rgba(13, 148, 136, 0.18)",
  colorPrimaryBorder: "rgba(45, 212, 191, 0.28)",

  // Shape
  borderRadius: 10,
  borderRadiusLG: 18,
  borderRadiusSM: 10,

  // Shadows
  boxShadow: "0 16px 40px rgba(2, 6, 23, 0.42), 0 8px 20px rgba(15, 23, 42, 0.24)",
  boxShadowSecondary: "0 24px 56px rgba(2, 6, 23, 0.5), 0 10px 28px rgba(15, 23, 42, 0.28)",
};

const LIGHT_THEME_COMPONENT_TOKEN = {
  Tag: {
    defaultBg: "rgba(13, 148, 136, 0.1)",
    defaultColor: "#0f766e",
  },
  Table: {
    bodySortBg: "rgba(13, 148, 136, 0.08)",
  },
} as const;

const DARK_THEME_COMPONENT_TOKEN = {
  Tag: {
    defaultBg: "rgba(45, 212, 191, 0.18)",
    defaultColor: "#ccfbf1",
  },
  Table: {
    bodySortBg: "rgba(45, 212, 191, 0.14)",
  },
} as const;

function App() {
  const { t } = useTranslation();
  const themeMode = useThemeStore((s) => s.themeMode);
  const setThemeMode = useThemeStore((s) => s.setThemeMode);
  const [appLocale, setAppLocale] = useState<AppLocale>(() => resolveInitialLocale());
  const [isSetupComplete, setIsSetupComplete] = useState<boolean | null>(null);
  const [backendStartupError, setBackendStartupError] = useState<string | null>(null);
  const [setupProbeNonce, setSetupProbeNonce] = useState(0);

  // Save theme to localStorage when it changes
  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    localStorage.setItem(APP_LOCALE_STORAGE_KEY, appLocale);
    void i18n.changeLanguage(appLocale);
  }, [appLocale]);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();

    const checkSetupStatus = async () => {
      try {
        const serviceFactory = ServiceFactory.getInstance();
        const status = await serviceFactory.getSetupStatus();
        if (cancelled) return;
        setBackendStartupError(null);
        setIsSetupComplete(status.is_complete);
      } catch (error) {
        if (cancelled) return;

        const elapsedMs = Date.now() - startedAt;
        // Give a local backend (embedded or Docker) time to come up before treating this
        // as a real "setup incomplete" signal.
        const maxWaitMs = import.meta.env.MODE === "test" ? 250 : 20_000;

        if (elapsedMs >= maxWaitMs) {
          const baseUrl = getBackendBaseUrlSync();
          const message =
            error instanceof Error && error.message.trim() ? error.message : "Unknown error";
          setBackendStartupError(t("app.backendNotReachable", { baseUrl, message }));
          // Keep `isSetupComplete` as null so we don't incorrectly show SetupPage.
          return;
        }

        // Retry with a small backoff. ApiClient already retries per request;
        // this loop handles the "backend not listening yet" startup window.
        const delayMs = Math.min(500 + Math.floor(elapsedMs / 2), 2000);
        setTimeout(() => {
          if (!cancelled) void checkSetupStatus();
        }, delayMs);
      }
    };

    void checkSetupStatus();
    return () => {
      cancelled = true;
    };
  }, [setupProbeNonce, t]);

  useEffect(() => {
    document.body.setAttribute("data-theme", themeMode);
  }, [themeMode]);

  useEffect(() => {
    const sync = () => {
      const enabled = isVdiSafeModeEnabled();
      document.body.setAttribute("data-vdi-safe", enabled ? "true" : "false");
      const rootElement = document.getElementById("root");
      if (rootElement) {
        rootElement.setAttribute("data-vdi-safe", enabled ? "true" : "false");
      }
    };

    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("lotus-vdi-safe-mode-change", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("lotus-vdi-safe-mode-change", sync);
    };
  }, []);

  useEffect(() => {
    const invoke = (window as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__
      ?.invoke;
    if (typeof invoke !== "function") {
      return;
    }

    void invoke("set_window_theme", { theme: themeMode }).catch((error: unknown) => {
      console.warn("[App] Failed to sync native window theme:", error);
    });
  }, [themeMode]);

  useEffect(() => {
    if (isSetupComplete) {
      initializeStore();
    }
  }, [isSetupComplete]);

  if (isSetupComplete === null) {
    if (backendStartupError) {
      return (
        <div style={{ padding: 40, textAlign: "center" }}>
          <div style={{ marginBottom: 12 }}>{backendStartupError}</div>
          <Button
            type="primary"
            onClick={() => {
              setBackendStartupError(null);
              setIsSetupComplete(null);
              setSetupProbeNonce((v) => v + 1);
            }}
          >
            {t("app.retry")}
          </Button>
        </div>
      );
    }
    return <div style={{ padding: 40, textAlign: "center" }}>{t("app.loading")}</div>;
  }

  const appContent = isSetupComplete ? (
    <MainLayout
      themeMode={themeMode}
      onThemeModeChange={setThemeMode}
      locale={appLocale}
      onLocaleChange={setAppLocale}
    />
  ) : (
    <SetupPage />
  );

  return (
    <AntdConfigProvider
      locale={getAntdLocale(appLocale)}
      theme={{
        token: themeMode === "dark" ? DARK_THEME_TOKEN : LIGHT_THEME_TOKEN,
        algorithm: themeMode === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
        components: themeMode === "dark" ? DARK_THEME_COMPONENT_TOKEN : LIGHT_THEME_COMPONENT_TOKEN,
      }}
    >
      <AntdApp>
        <ErrorBoundary name="App">
          <div style={{ position: "relative" }}>{appContent}</div>
        </ErrorBoundary>
      </AntdApp>
    </AntdConfigProvider>
  );
}

export default App;
