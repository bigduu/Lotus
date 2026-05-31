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
  // Brand primary — 石绿 (malachite) mineral 青绿, after《千里江山图》
  colorPrimary: "#157f6b",
  colorPrimaryHover: "#1b9a82",
  colorPrimaryActive: "#0f5f51",
  // Info / secondary — 石青 (azurite) mineral azure, the duotone partner to 石绿
  colorInfo: "#2b6e8f",
  colorLink: "#157f6b",
  colorLinkHover: "#1b9a82",
  colorLinkActive: "#0f5f51",
  colorSuccess: "#2e9e6f",
  // Warning — 泥金 (gold leaf)
  colorWarning: "#c08a2e",
  // Error — 朱砂 (cinnabar)
  colorError: "#d24b3c",

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
  colorBgLayout: "#eef5f1",
  colorBgContainer: "rgba(255, 255, 255, 0.82)",
  colorBgElevated: "rgba(255, 255, 255, 0.9)",
  colorBgSpotlight: "rgba(21, 127, 107, 0.16)",
  colorPrimaryBg: "#e6f1ec",
  colorPrimaryBgHover: "#cfe6dd",
  colorPrimaryBorder: "#9fd0c1",

  // Shape
  borderRadius: 10,
  borderRadiusLG: 18,
  borderRadiusSM: 10,

  // Shadows
  boxShadow: "0 12px 36px rgba(15, 118, 110, 0.10), 0 6px 18px rgba(15, 23, 42, 0.06)",
  boxShadowSecondary: "0 20px 48px rgba(15, 118, 110, 0.12), 0 8px 24px rgba(15, 23, 42, 0.08)",
};

const DARK_THEME_TOKEN = {
  // Brand primary — 石绿 (malachite) lifted for dark mode, after《千里江山图》
  colorPrimary: "#46c2a0",
  colorPrimaryHover: "#6ad7b8",
  colorPrimaryActive: "#2e9e7f",
  // Info / secondary — 石青 (azurite) azure
  colorInfo: "#5aa9cf",
  colorLink: "#46c2a0",
  colorLinkHover: "#6ad7b8",
  colorLinkActive: "#2e9e7f",
  colorSuccess: "#4cc08c",
  // Warning — 泥金 (gold leaf)
  colorWarning: "#dcae4c",
  // Error — 朱砂 (cinnabar)
  colorError: "#ef6a5c",

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
  colorBgLayout: "#070f0d",
  colorBgContainer: "rgba(11, 23, 20, 0.76)",
  colorBgElevated: "rgba(15, 31, 27, 0.9)",
  colorBgSpotlight: "rgba(21, 127, 107, 0.22)",
  colorPrimaryBg: "rgba(21, 127, 107, 0.16)",
  colorPrimaryBgHover: "rgba(21, 127, 107, 0.22)",
  colorPrimaryBorder: "rgba(70, 194, 160, 0.30)",

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
    defaultBg: "rgba(21, 127, 107, 0.10)",
    defaultColor: "#0f5f51",
  },
  Table: {
    bodySortBg: "rgba(21, 127, 107, 0.08)",
  },
} as const;

const DARK_THEME_COMPONENT_TOKEN = {
  Tag: {
    defaultBg: "rgba(70, 194, 160, 0.18)",
    defaultColor: "#c8efe2",
  },
  Table: {
    bodySortBg: "rgba(70, 194, 160, 0.14)",
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
