import React, { useEffect, useMemo } from "react";
import { Button, Layout, theme, Drawer } from "antd";
import { MenuUnfoldOutlined } from "@ant-design/icons";
import { useIsMobile } from "../shared/hooks/useMediaQuery";
import { useTranslation } from "react-i18next";
import { ChatSidebar } from "../pages/ChatPage/components/ChatSidebar";
import { SystemSettingsPage } from "../pages/SettingsPage/components/SystemSettingsPage";
import { ErrorBoundary } from "@shared/components/ErrorBoundary";
import { ChatAutoTitleEffect } from "../pages/ChatPage/components/ChatAutoTitleEffect";
import { useSettingsViewStore } from "../shared/store/settingsViewStore";
import { useMermaidTheme } from "../shared/components/MermaidChart/useMermaidTheme";
import { mermaidCache } from "../shared/components/MermaidChart/mermaidConfig";
import { clearMermaidRenderCache } from "../shared/components/MermaidChart/mermaidRenderManager";
import { useMermaidSettings } from "../shared/store/mermaidSettingsStore";
import { useAgentEventSubscription } from "@hooks/useAgentEventSubscription";
import { useProviderStore } from "../pages/ChatPage/store/slices/providerSlice";
import { MultiPaneChatView } from "../pages/ChatPage/components/MultiPaneChatView";
import { useUILayoutStore } from "../shared/store/uiLayoutStore";
import { ResizableSplit } from "../shared/components/ResizableSplit";
import type { AppLocale } from "../shared/i18n/types";
import { detectOS } from "../shared/utils/osInfoUtils";
import { CommandPalette } from "@shared/components/CommandPalette";
import { FeatureGuide } from "@shared/components/FeatureGuide";

const OPEN_PROVIDER_FLAG = "bodhi_open_provider_on_entry";

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

  // Load provider configuration once for the whole app.
  const loadProviderConfig = useProviderStore((state) => state.loadProviderConfig);
  useEffect(() => {
    loadProviderConfig();
  }, [loadProviderConfig]);

  // Auto-open Settings to Provider tab if user clicked "Configure Provider" during setup.
  useEffect(() => {
    if (localStorage.getItem(OPEN_PROVIDER_FLAG) === "true") {
      localStorage.removeItem(OPEN_PROVIDER_FLAG);
      useSettingsViewStore.getState().open("chat", "provider");
    }
  }, []);

  // Maintain a single persistent subscription to agent events.
  useAgentEventSubscription();

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
  const mobileDrawerWidthPx = "min(86vw, 360px)";

  return (
    <>
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
      <CommandPalette />
      <FeatureGuide disabled={settingsOpen} />
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
                <SystemSettingsPage
                  themeMode={themeMode}
                  onThemeModeChange={onThemeModeChange}
                  locale={locale}
                  onLocaleChange={onLocaleChange}
                  onBack={closeSettings}
                />
              </ErrorBoundary>
            </Layout>
          ) : (
            <>
              <ChatAutoTitleEffect />

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
                        borderRadius: `0 ${shellRadiusPx}px ${shellRadiusPx}px 0`,
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
