import { theme, type ThemeConfig } from "antd";

/**
 * Ant Design theme tokens for the app.
 *
 * Light/dark variants, plus VDI "compatibility" variants that swap
 * translucent surfaces for solid colors (translucency renders poorly in
 * some virtual-desktop/remoting setups). `resolveThemeTokens` picks the
 * right set so callers don't repeat the mode/vdi branching.
 */

type ThemeMode = "light" | "dark";

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

const LIGHT_THEME_COMPATIBILITY_TOKEN = {
  ...LIGHT_THEME_TOKEN,
  colorBgElevated: "#ffffff",
  colorBgSpotlight: "#0f172a",
  colorFillTertiary: "#f3f7f6",
} as const;

const DARK_THEME_COMPATIBILITY_TOKEN = {
  ...DARK_THEME_TOKEN,
  colorBgElevated: "#0f1b18",
  colorBgSpotlight: "#22332f",
  colorFillTertiary: "#162622",
} as const;

const LIGHT_THEME_COMPATIBILITY_COMPONENT_TOKEN = {
  ...LIGHT_THEME_COMPONENT_TOKEN,
  Menu: {
    popupBg: "#ffffff",
    itemBg: "transparent",
    itemHoverBg: "#f3f7f6",
    itemActiveBg: "#eef7f5",
    itemSelectedBg: "#e7f8f4",
    subMenuItemBg: "#ffffff",
    dangerItemActiveBg: "#fdecec",
    dangerItemSelectedBg: "#fdecec",
  },
  Select: {
    selectorBg: "#ffffff",
    clearBg: "#ffffff",
    optionActiveBg: "#f3f7f6",
    optionSelectedBg: "#e7f8f4",
  },
  Modal: {
    contentBg: "#ffffff",
    headerBg: "#ffffff",
    footerBg: "#ffffff",
  },
} as const;

const DARK_THEME_COMPATIBILITY_COMPONENT_TOKEN = {
  ...DARK_THEME_COMPONENT_TOKEN,
  Menu: {
    popupBg: "#0f1b18",
    darkPopupBg: "#0f1b18",
    itemBg: "transparent",
    itemHoverBg: "#162622",
    itemActiveBg: "#162622",
    itemSelectedBg: "#12332d",
    subMenuItemBg: "#0f1b18",
    dangerItemActiveBg: "#3a161c",
    dangerItemSelectedBg: "#3a161c",
  },
  Select: {
    selectorBg: "#0f1b18",
    clearBg: "#0f1b18",
    optionActiveBg: "#162622",
    optionSelectedBg: "#12332d",
  },
  Modal: {
    contentBg: "#0f1b18",
    headerBg: "#0f1b18",
    footerBg: "#0f1b18",
  },
} as const;

/**
 * Resolve the ConfigProvider theme inputs for the current mode + VDI flag.
 */
export function resolveThemeTokens(
  themeMode: ThemeMode,
  isVdiSafeMode: boolean,
): Pick<ThemeConfig, "token" | "components" | "algorithm"> {
  const token =
    themeMode === "dark"
      ? isVdiSafeMode
        ? DARK_THEME_COMPATIBILITY_TOKEN
        : DARK_THEME_TOKEN
      : isVdiSafeMode
        ? LIGHT_THEME_COMPATIBILITY_TOKEN
        : LIGHT_THEME_TOKEN;

  const components =
    themeMode === "dark"
      ? isVdiSafeMode
        ? DARK_THEME_COMPATIBILITY_COMPONENT_TOKEN
        : DARK_THEME_COMPONENT_TOKEN
      : isVdiSafeMode
        ? LIGHT_THEME_COMPATIBILITY_COMPONENT_TOKEN
        : LIGHT_THEME_COMPONENT_TOKEN;

  const algorithm = themeMode === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm;

  return { token, components, algorithm };
}
