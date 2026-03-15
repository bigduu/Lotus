import { useEffect, useState } from "react";
import { App as AntApp, Button, ConfigProvider, theme } from "antd";
import { useTranslation } from "react-i18next";
import "./App.css";
import "@shared/i18n";
import { MainLayout } from "./MainLayout";
import { SetupPage } from "../pages/SetupPage";
import { initializeStore } from "../pages/ChatPage/store";
import { ServiceFactory } from "../services/common/ServiceFactory";
import { getBackendBaseUrlSync } from "../shared/utils/backendBaseUrl";
import i18n from "@shared/i18n";
import { getAntdLocale } from "@shared/i18n/antdLocale";
import {
  APP_LOCALE_STORAGE_KEY,
  type AppLocale,
  resolveInitialLocale,
} from "@shared/i18n/types";

const THEME_STORAGE_KEY = "copilot_ui_theme_v1";

function App() {
  const { t } = useTranslation();
  const [themeMode, setThemeMode] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return (saved as "light" | "dark") || "light";
  });
  const [appLocale, setAppLocale] = useState<AppLocale>(() =>
    resolveInitialLocale(),
  );
  const [isSetupComplete, setIsSetupComplete] = useState<boolean | null>(null);
  const [backendStartupError, setBackendStartupError] = useState<string | null>(
    null,
  );
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
            error instanceof Error && error.message.trim()
              ? error.message
              : "Unknown error";
          setBackendStartupError(
            t("app.backendNotReachable", { baseUrl, message }),
          );
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
    return (
      <div style={{ padding: 40, textAlign: "center" }}>{t("app.loading")}</div>
    );
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
    <ConfigProvider
      locale={getAntdLocale(appLocale)}
      theme={{
        token: {
          colorPrimary: "#1677ff",
          borderRadius: 6,
        },
        algorithm:
          themeMode === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
      }}
    >
      <AntApp>
        <div style={{ position: "relative" }}>{appContent}</div>
      </AntApp>
    </ConfigProvider>
  );
}

export default App;
