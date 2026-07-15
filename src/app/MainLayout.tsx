import React, { useEffect, useMemo, useState } from "react";
import { Button, Layout, theme, Drawer } from "antd";
import { MenuUnfoldOutlined } from "@ant-design/icons";
import { useIsMobile } from "../shared/hooks/useMediaQuery";
import { useTranslation } from "react-i18next";
import { ChatSidebar } from "../pages/ChatPage/components/ChatSidebar";
import { ErrorBoundary } from "@shared/components/ErrorBoundary";
import { useSettingsViewStore } from "../shared/store/settingsViewStore";
import { useMermaidTheme } from "../shared/components/MermaidChart/useMermaidTheme";
import { mermaidCache } from "../shared/components/MermaidChart/mermaidConfig";
import { clearMermaidRenderCache } from "../shared/components/MermaidChart/mermaidRenderManager";
import { useMermaidSettings } from "../shared/store/mermaidSettingsStore";
import { useAgentEventSubscription } from "@pages/ChatPage/hooks/useAgentEventSubscription";
import { MultiPaneChatView } from "../pages/ChatPage/components/MultiPaneChatView";
import { useUILayoutStore } from "../shared/store/uiLayoutStore";
import { ResizableSplit } from "../shared/components/ResizableSplit";
import { ConfigRecoveryBanner } from "@shared/components/ConfigRecoveryBanner";
import { useConfigRecoveryStore } from "@shared/store/configRecoveryStore";
import type { AppLocale } from "../shared/i18n/types";
import { detectOS } from "../shared/utils/osInfoUtils";

// ── Lazy-loaded non-critical UI ─────────────────────────────────────────
// SystemSettingsPage is a heavy component only needed when the settings
// drawer is open.  Using React.lazy avoids parsing & evaluating its entire
// dependency tree (MCP tables, metrics charts, schedules, etc.) during the
// initial startup render.
const LazySystemSettingsPage = React.lazy(() =>
  import("../pages/SettingsPage/components/SystemSettingsPage").then((m) => ({
    default: m.SystemSettingsPage,
  })),
);

// CommandPalette registers its own keyboard shortcut (⌘K) in a useEffect.
// By lazy-loading it the heavy modal + action list is kept off the startup
// bundle.  We install a lightweight global keydown listener below so the
// shortcut is responsive even before the chunk loads.
const LazyCommandPalette = React.lazy(() =>
  import("@shared/components/CommandPalette").then((m) => ({
    default: m.CommandPalette,
  })),
);

// FeatureGuide is an onboarding tour – never needed on the critical path.
const LazyFeatureGuide = React.lazy(() =>
  import("@shared/components/FeatureGuide/FeatureGuide").then((m) => ({
    default: m.FeatureGuide,
  })),
);

// LedgerDrawer hosts the personal-assistant agenda (ledger records). It is
// closed by default and only needs to exist to keep the trigger badge fresh,
// so it mounts on the same idle gate as the other auxiliary surfaces.
const LazyLedgerDrawer = React.lazy(() =>
  import("@shared/components/LedgerDrawer").then((m) => ({
    default: m.LedgerDrawer,
  })),
);

const OPEN_PROVIDER_FLAG = "bodhi_open_provider_on_entry";
const COMMAND_PALETTE_FORCE_OPEN_KEY = "__LOTUS_COMMAND_PALETTE_FORCE_OPEN__";

// ── Deferred agent subscription ──────────────────────────────────────────
// Thin wrapper that mounts the agent-event subscription hook only once the
// idle-gate (`auxReady`) is true.  This keeps AgentClient instantiation,
// store selector subscriptions, and the reconciliation effect off the
// critical first-paint path.  On cold start there are typically no busy
// sessions, so the hook would be a no-op anyway — deferring saves ~5–10 ms.
const DeferredAgentSubscription: React.FC = () => {
  useAgentEventSubscription();
  return null;
};

export const MainLayout: React.FC<{
  themeMode: "light" | "dark";
  onThemeModeChange: (mode: "light" | "dark") => void;
  locale: AppLocale;
  onLocaleChange: (locale: AppLocale) => void;
}> = ({ themeMode, onThemeModeChange, locale, onLocaleChange }) => {
  const settingsOpen = useSettingsViewStore((s) => s.isOpen);
  const closeSettings = useSettingsViewStore((s) => s.close);
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const mermaidSettings = useMermaidSettings();
  const isMacOS = useMemo(() => detectOS() === "macos", []);

  // Auto-open Settings to Provider tab if user clicked "Configure Provider" during setup.
  useEffect(() => {
    if (localStorage.getItem(OPEN_PROVIDER_FLAG) === "true") {
      localStorage.removeItem(OPEN_PROVIDER_FLAG);
      useSettingsViewStore.getState().open("chat", "provider");
    }
  }, []);

  // Config-corruption recovery (#59): force a fresh check whenever Settings
  // opens, on top of the ConfigRecoveryBanner's own boot-time check — catches
  // a recovery that became pending after the app already booted.
  useEffect(() => {
    if (settingsOpen) {
      void useConfigRecoveryStore.getState().checkStatus({ force: true });
    }
  }, [settingsOpen]);

  // Maintain a single persistent subscription to agent events.
  // Deferred until the browser is idle via the DeferredAgentSubscription
  // wrapper — see that component for rationale.

  // Enable global Mermaid theme updates
  useMermaidTheme();

  // Clear Mermaid cache when theme changes to force re-render
  useEffect(() => {
    mermaidCache.clear();
    clearMermaidRenderCache();
  }, [themeMode]);

  // Clear Mermaid cache when user settings change
  useEffect(() => {
    mermaidCache.clear();
    clearMermaidRenderCache();
  }, [mermaidSettings]);

  // Sidebar sizing (persisted)
  const sidebarCollapsed = useUILayoutStore((s) => s.sidebar.collapsed);
  const sidebarWidthPx = useUILayoutStore((s) => s.sidebar.widthPx);
  const sidebarMinWidthPx = useUILayoutStore((s) => s.sidebar.minWidthPx);
  const sidebarMaxWidthPx = useUILayoutStore((s) => s.sidebar.maxWidthPx);
  const setSidebarCollapsed = useUILayoutStore((s) => s.setSidebarCollapsed);
  const setSidebarWidthPx = useUILayoutStore((s) => s.setSidebarWidthPx);
  const shellRadiusPx = 18;
  const workspaceInsetPx = 0;
  const collapsedMacWindowInsetTopPx = 44;
  const workspaceInsetTopPx =
    !settingsOpen && sidebarCollapsed && isMacOS ? collapsedMacWindowInsetTopPx : workspaceInsetPx;
  const sidebarHiddenWidthPx = 0;
  const collapsedToggleInsetLeftPx = 88;
  const collapsedToggleInsetTopPx = 10;
  const surfaceBorder = "none";

  const isMobile = useIsMobile();
  // Near-full width on phones: the old min(86vw, 360px) left an ugly strip of
  // chat bleeding past the drawer's right edge on ~390px screens.
  const mobileDrawerWidthPx = "min(94vw, 460px)";

  // ── Deferred mount gates ──────────────────────────────────────────────
  // CommandPalette and FeatureGuide are non-critical for the first paint.
  // We mount them after the browser becomes idle (or after a short timeout
  // on environments without requestIdleCallback).
  const [auxReady, setAuxReady] = useState(false);

  useEffect(() => {
    // Immediately request idle callback; fall back to a short timeout.
    if (typeof requestIdleCallback === "function") {
      const handle = requestIdleCallback(() => setAuxReady(true));
      return () => cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(() => setAuxReady(true), 200);
    return () => window.clearTimeout(timer);
  }, []);

  // Lightweight ⌘K bootstrap that only runs before CommandPalette mounts.
  // Once auxReady is true, CommandPalette's own key handler takes over so
  // open/close toggling semantics stay unchanged.
  useEffect(() => {
    const onEarlyCommandShortcut = (event: KeyboardEvent) => {
      const isOpenShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (!isOpenShortcut || auxReady) {
        return;
      }

      event.preventDefault();
      (
        window as typeof window & {
          [COMMAND_PALETTE_FORCE_OPEN_KEY]?: boolean;
        }
      )[COMMAND_PALETTE_FORCE_OPEN_KEY] = true;
      setAuxReady(true);
    };

    window.addEventListener("keydown", onEarlyCommandShortcut);
    return () => window.removeEventListener("keydown", onEarlyCommandShortcut);
  }, [auxReady]);

  return (
    <>
      {/* Blocking banner for a pending config-corruption recovery (#59). Mounted
          globally so it's visible on both the chat and Settings views. */}
      <ConfigRecoveryBanner />
      {/* Skip to main content link for keyboard/screen-reader users */}
      <a
        href="#lotus-main-content"
        className="lotus-skip-link"
        style={{
          position: "absolute",
          top: -9999,
          left: -9999,
          zIndex: 10000,
          padding: "8px 16px",
          background: "var(--lotus-main-surface, #fff)",
          color: "var(--ant-color-primary, #0d9488)",
          borderRadius: 8,
          fontWeight: 600,
          textDecoration: "none",
        }}
        onFocus={(e) => {
          e.currentTarget.style.top = "8px";
          e.currentTarget.style.left = "8px";
        }}
        onBlur={(e) => {
          e.currentTarget.style.top = "-9999px";
          e.currentTarget.style.left = "-9999px";
        }}
      >
        {t("app.skipToContent", "Skip to main content")}
      </a>
      {auxReady && (
        <React.Suspense fallback={null}>
          <LazyCommandPalette />
        </React.Suspense>
      )}
      {auxReady && (
        <React.Suspense fallback={null}>
          <LazyFeatureGuide disabled={settingsOpen} />
        </React.Suspense>
      )}
      {auxReady && (
        <React.Suspense fallback={null}>
          <LazyLedgerDrawer />
        </React.Suspense>
      )}
      {auxReady && <DeferredAgentSubscription />}
      <Layout
        style={{
          minHeight: "100vh",
          height: "100vh",
          overflow: "hidden",
          background: "transparent",
          display: "flex",
          flexDirection: "row",
          position: "relative",
        }}
      >
        <div
          style={{
            display: "flex",
            flex: 1,
            minHeight: 0,
            height: "100%",
            width: "100%",
            boxSizing: "border-box",
            paddingTop: workspaceInsetTopPx,
            paddingLeft: workspaceInsetPx,
            paddingRight: workspaceInsetPx,
            paddingBottom: workspaceInsetPx,
            background: "transparent",
          }}
        >
          {settingsOpen ? (
            <Layout
              className="lotus-shell-panel lotus-settings-panel lotus-page-enter"
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                background: "var(--lotus-main-surface)",
                minHeight: 0,
                borderRadius: `${shellRadiusPx}px 0 0 ${shellRadiusPx}px`,
                border: surfaceBorder,
                overflow: "hidden",
              }}
            >
              <ErrorBoundary name="SystemSettings">
                <React.Suspense
                  fallback={
                    <div style={{ padding: 24, color: "var(--ant-color-text-secondary)" }}>
                      {t("app.loading", "Loading…")}
                    </div>
                  }
                >
                  <LazySystemSettingsPage
                    themeMode={themeMode}
                    onThemeModeChange={onThemeModeChange}
                    locale={locale}
                    onLocaleChange={onLocaleChange}
                    onBack={closeSettings}
                  />
                </React.Suspense>
              </ErrorBoundary>
            </Layout>
          ) : (
            <>
              {isMobile ? (
                <>
                  <Drawer
                    placement="left"
                    closable={false}
                    onClose={() => setSidebarCollapsed(true)}
                    open={!sidebarCollapsed}
                    width={mobileDrawerWidthPx}
                    styles={{ body: { padding: 0, background: "var(--lotus-sidebar-bg)" } }}
                  >
                    <ChatSidebar />
                  </Drawer>
                  <main
                    id="lotus-main-content"
                    className="lotus-shell-panel lotus-shell-main"
                    style={{
                      flex: 1,
                      height: "100%",
                      minHeight: 0,
                      borderRadius: `${shellRadiusPx}px`,
                      border: surfaceBorder,
                      overflow: "hidden",
                      background: "var(--lotus-main-surface)",
                      boxShadow: "var(--lotus-shadow-shell)",
                    }}
                  >
                    <Layout
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        background: "transparent",
                        minHeight: 0,
                        height: "100%",
                      }}
                    >
                      <MultiPaneChatView />
                    </Layout>
                  </main>
                </>
              ) : (
                <ResizableSplit
                  layout="horizontal"
                  style={{
                    flex: 1,
                    minHeight: 0,
                    height: "100%",
                    background: "transparent",
                  }}
                  sizesPx={[sidebarCollapsed ? sidebarHiddenWidthPx : sidebarWidthPx, 0]}
                  minFirstPx={sidebarCollapsed ? sidebarHiddenWidthPx : sidebarMinWidthPx}
                  // Keep the same max behavior by clamping in the store setter.
                  // We still want the drag interaction to feel bounded though.
                  minSecondPx={320}
                  disabled={sidebarCollapsed}
                  handleSizePx={sidebarCollapsed ? 0 : 2}
                  onResizeEnd={([firstPx]) => {
                    if (sidebarCollapsed) return;
                    const clamped = Math.max(
                      sidebarMinWidthPx,
                      Math.min(sidebarMaxWidthPx, firstPx),
                    );
                    setSidebarWidthPx(clamped);
                  }}
                  first={
                    <div
                      className="lotus-shell-panel lotus-shell-sidebar"
                      style={{
                        height: "100%",
                        minHeight: 0,
                        borderRadius: `${shellRadiusPx}px 0 0 ${shellRadiusPx}px`,
                        border: surfaceBorder,
                        overflow: "hidden",
                        background: "var(--lotus-sidebar-bg)",
                      }}
                    >
                      <ChatSidebar />
                    </div>
                  }
                  second={
                    <main
                      id="lotus-main-content"
                      className="lotus-shell-panel lotus-shell-main"
                      style={{
                        height: "100%",
                        minHeight: 0,
                        borderRadius: sidebarCollapsed
                          ? `${shellRadiusPx}px`
                          : `0 ${shellRadiusPx}px ${shellRadiusPx}px 0`,
                        border: surfaceBorder,
                        overflow: "hidden",
                        background: "var(--lotus-main-surface)",
                        boxShadow: "var(--lotus-shadow-shell)",
                      }}
                    >
                      <Layout
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          background: "transparent",
                          minHeight: 0,
                          height: "100%",
                        }}
                      >
                        <MultiPaneChatView />
                      </Layout>
                    </main>
                  }
                />
              )}
            </>
          )}

          {!settingsOpen && sidebarCollapsed ? (
            <Button
              data-testid="show-sidebar"
              type="text"
              size="small"
              icon={<MenuUnfoldOutlined />}
              onClick={() => setSidebarCollapsed(false)}
              title={t("layout.showSidebar")}
              aria-label={t("layout.showSidebar")}
              className="lotus-toolbar-icon lotus-floating-sidebar-toggle"
              style={{
                position: "absolute",
                top: isMobile ? 8 : collapsedToggleInsetTopPx,
                left: isMobile ? 8 : collapsedToggleInsetLeftPx,
                zIndex: 40,
                width: 36,
                height: 36,
                borderRadius: 12,
                border: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorBgElevated,
                boxShadow: token.boxShadowSecondary,
              }}
            />
          ) : null}
        </div>
      </Layout>
    </>
  );
};
