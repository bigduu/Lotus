import { useEffect, useState } from "react";
import { App as AntdApp, Button, ConfigProvider as AntdConfigProvider, Flex, Spin } from "antd";
import { useTranslation } from "react-i18next";
import "./App.css";
import { MainLayout } from "./MainLayout";
import { ErrorBoundary } from "@shared/components/ErrorBoundary";
import { useThemeStore } from "@shared/store/themeStore";
import { SetupPage } from "../pages/SetupPage";
import { PasswordGatePage } from "../pages/PasswordGatePage";
import { bootstrapCritical, bootstrapDeferred } from "@shared/store/appStore";
import { ServiceFactory } from "../services/common/ServiceFactory";
import { getBackendBaseUrlSync } from "../shared/utils/backendBaseUrl";
import { changeLocale } from "@shared/i18n";
import { getAntdLocale } from "@shared/i18n/antdLocale";
import type { Locale } from "antd/es/locale";
import { APP_LOCALE_STORAGE_KEY, type AppLocale, resolveInitialLocale } from "@shared/i18n/types";
import { isVdiSafeModeEnabled } from "@shared/utils/vdiSafeMode";
import { THEME_STORAGE_KEY } from "@shared/theme/storageKeys";
import { resolveThemeTokens } from "@shared/theme/tokens";
import { useIsMobile } from "@shared/hooks/useMediaQuery";
import { StorageManager } from "../services/storage/StorageManager";
import { migrateFromLocalStorage } from "../services/storage/migrateFromLocalStorage";

function App() {
  const { t } = useTranslation();
  const themeMode = useThemeStore((s) => s.themeMode);
  const setThemeMode = useThemeStore((s) => s.setThemeMode);
  const isMobile = useIsMobile();
  const [appLocale, setAppLocale] = useState<AppLocale>(() => resolveInitialLocale());
  const [isVdiSafeMode, setIsVdiSafeMode] = useState<boolean>(() => isVdiSafeModeEnabled());
  const [isSetupComplete, setIsSetupComplete] = useState<boolean | null>(null);
  const [backendStartupError, setBackendStartupError] = useState<string | null>(null);
  const [setupProbeNonce, setSetupProbeNonce] = useState(0);
  const [accessStatus, setAccessStatus] = useState<{
    password_enabled: boolean;
    local_bypass: boolean;
    requires_password: boolean;
  } | null>(null);
  const [isAccessVerified, setIsAccessVerified] = useState(false);
  const [antdLocale, setAntdLocale] = useState<Locale | null>(null);
  // Slow-start feedback (#172): the backend probe can retry for up to ~20s
  // — after a few seconds, tell the user what the wait is about.
  const [startupWaitLong, setStartupWaitLong] = useState(false);

  useEffect(() => {
    if (isSetupComplete !== null || backendStartupError) {
      setStartupWaitLong(false);
      return;
    }
    const timer = setTimeout(() => setStartupWaitLong(true), 5000);
    return () => clearTimeout(timer);
  }, [isSetupComplete, backendStartupError]);

  // antd locale bundles load on demand (see antdLocale.ts). Resolve the active
  // locale whenever appLocale changes; null briefly until the chunk loads.
  useEffect(() => {
    let cancelled = false;
    void getAntdLocale(appLocale).then((locale) => {
      if (!cancelled) setAntdLocale(locale);
    });
    return () => {
      cancelled = true;
    };
  }, [appLocale]);

  // Save theme to localStorage when it changes
  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    localStorage.setItem(APP_LOCALE_STORAGE_KEY, appLocale);
    void changeLocale(appLocale);
  }, [appLocale]);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();

    const checkStartupState = async () => {
      try {
        const serviceFactory = ServiceFactory.getInstance();
        const access = await serviceFactory.getAccessStatus();
        if (cancelled) return;

        setBackendStartupError(null);
        setAccessStatus(access);

        if (access.requires_password && !isAccessVerified) {
          setIsSetupComplete(false);
          return;
        }

        const status = await serviceFactory.getSetupStatus();
        if (cancelled) return;
        setIsSetupComplete(status.is_complete);
      } catch (error) {
        if (cancelled) return;

        const elapsedMs = Date.now() - startedAt;
        // Give a local backend (embedded or Docker) time to come up before treating this
        // as a real startup failure.
        const maxWaitMs = import.meta.env.MODE === "test" ? 250 : 20_000;

        if (elapsedMs >= maxWaitMs) {
          const baseUrl = getBackendBaseUrlSync();
          const message =
            error instanceof Error && error.message.trim() ? error.message : "Unknown error";
          setBackendStartupError(t("app.backendNotReachable", { baseUrl, message }));
          return;
        }

        const delayMs = Math.min(500 + Math.floor(elapsedMs / 2), 2000);
        setTimeout(() => {
          if (!cancelled) void checkStartupState();
        }, delayMs);
      }
    };

    void checkStartupState();
    return () => {
      cancelled = true;
    };
  }, [isAccessVerified, setupProbeNonce, t]);

  useEffect(() => {
    document.body.setAttribute("data-theme", themeMode);
  }, [themeMode]);

  useEffect(() => {
    const sync = () => {
      const enabled = isVdiSafeModeEnabled();
      setIsVdiSafeMode(enabled);
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
    if (!isSetupComplete) {
      return;
    }

    // Staged bootstrap: await critical (provider + chats) so the shell has
    // sessions, then kick off deferred (models + prompts) in the background
    // without blocking the first useful render.
    bootstrapCritical()
      .then(() => {
        return bootstrapDeferred();
      })
      .catch((err) => {
        console.error("[App] Bootstrap error:", err);
      });
  }, [isSetupComplete]);

  // Cleanup stale IndexedDB data on startup and periodically
  useEffect(() => {
    const manager = StorageManager.getInstance();

    // 启动时清理过期数据（30天）
    manager.cleanupStaleData(30).catch((err) => {
      console.warn("[App] Failed to cleanup stale storage data:", err);
    });

    // 每24小时清理一次
    const interval = setInterval(
      () => {
        manager.cleanupStaleData(30).catch(() => {});
      },
      24 * 60 * 60 * 1000,
    );

    return () => clearInterval(interval);
  }, []);

  // Migrate localStorage data to IndexedDB
  useEffect(() => {
    // 延迟执行迁移，避免阻塞启动
    const timeout = setTimeout(() => {
      migrateFromLocalStorage().catch((err) => {
        console.warn("[App] Storage migration failed:", err);
      });
    }, 5000); // 启动后5秒执行

    return () => clearTimeout(timeout);
  }, []);

  const {
    token: themeToken,
    components: themeComponents,
    algorithm: themeAlgorithm,
  } = resolveThemeTokens(themeMode, isVdiSafeMode, isMobile);

  if (accessStatus?.requires_password && !isAccessVerified) {
    return (
      <AntdConfigProvider
        locale={antdLocale ?? undefined}
        theme={{
          token: themeToken,
          algorithm: themeAlgorithm,
          components: themeComponents,
        }}
      >
        <AntdApp>
          <ErrorBoundary name="PasswordGatePage">
            <PasswordGatePage
              verifyPassword={async (password) => {
                await ServiceFactory.getInstance().verifyAccessPassword(password);
              }}
              onVerified={async () => {
                setIsAccessVerified(true);
                setBackendStartupError(null);
                setSetupProbeNonce((v) => v + 1);
              }}
            />
          </ErrorBoundary>
        </AntdApp>
      </AntdConfigProvider>
    );
  }

  if (isSetupComplete === null) {
    if (backendStartupError) {
      return (
        <div style={{ padding: 40, textAlign: "center" }}>
          <div style={{ marginBottom: 12 }}>{backendStartupError}</div>
          <Button
            type="primary"
            onClick={() => {
              setBackendStartupError(null);
              setAccessStatus(null);
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
      <Flex
        vertical
        align="center"
        justify="center"
        gap={12}
        style={{ padding: 40, minHeight: "40vh" }}
      >
        <Spin size="large" />
        <div>{t("app.loading")}</div>
        {startupWaitLong ? (
          <div style={{ opacity: 0.65, fontSize: 13 }}>{t("app.loadingSlow")}</div>
        ) : null}
      </Flex>
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
    <AntdConfigProvider
      locale={antdLocale ?? undefined}
      theme={{
        token: themeToken,
        algorithm: themeAlgorithm,
        components: themeComponents,
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
