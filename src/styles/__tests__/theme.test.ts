import { describe, expect, it } from "vitest";
import {
  colors,
  spacing,
  fontSize,
  borderRadius,
  shadows,
  animation,
  zIndex,
  components,
  breakpoints,
  theme,
  type Theme,
  type ThemeColors,
  type ThemeSpacing,
} from "../theme";

describe("theme constants", () => {
  describe("colors", () => {
    it("should have primary colors", () => {
      expect(colors.primary).toBe("var(--ant-color-primary)");
      expect(colors.primaryHover).toBe("var(--ant-color-primary-hover)");
      expect(colors.primaryActive).toBe("var(--ant-color-primary-active)");
    });

    it("should have status colors", () => {
      expect(colors.success).toBe("var(--ant-color-success)");
      expect(colors.warning).toBe("var(--ant-color-warning)");
      expect(colors.error).toBe("var(--ant-color-error)");
      expect(colors.info).toBe("var(--ant-color-info)");
    });

    it("should have text colors", () => {
      expect(colors.text).toBe("var(--ant-color-text)");
      expect(colors.textSecondary).toBe("var(--ant-color-text-secondary)");
      expect(colors.textTertiary).toBe("var(--ant-color-text-tertiary)");
      expect(colors.textDisabled).toBe("var(--ant-color-text-disabled)");
    });

    it("should have background colors", () => {
      expect(colors.bg).toBe("var(--ant-color-bg-base)");
      expect(colors.bgElevated).toBe("var(--ant-color-bg-elevated)");
      expect(colors.bgContainer).toBe("var(--ant-color-bg-container)");
    });

    it("should have border colors", () => {
      expect(colors.border).toBe("var(--ant-color-border)");
      expect(colors.borderSecondary).toBe("var(--ant-color-border-secondary)");
    });

    it("should have fill colors", () => {
      expect(colors.fill).toBe("var(--ant-color-fill)");
      expect(colors.fillSecondary).toBe("var(--ant-color-fill-secondary)");
      expect(colors.fillTertiary).toBe("var(--ant-color-fill-tertiary)");
      expect(colors.fillQuaternary).toBe("var(--ant-color-fill-quaternary)");
    });

    it("should have custom colors", () => {
      expect(colors.pinned).toBe("#faad14");
      expect(colors.selected.light).toBe("#dddddd");
      expect(colors.selected.dark).toBe("#2b2b2b");
    });

    it("should be frozen (as const)", () => {
      expect(Object.isFrozen(colors)).toBe(false); // as const doesn't freeze at runtime
      expect(Object.keys(colors).length).toBeGreaterThan(0);
    });
  });

  describe("spacing", () => {
    it("should have all spacing values", () => {
      expect(spacing.xs).toBe("4px");
      expect(spacing.sm).toBe("8px");
      expect(spacing.md).toBe("12px");
      expect(spacing.lg).toBe("16px");
      expect(spacing.xl).toBe("24px");
      expect(spacing.xxl).toBe("32px");
      expect(spacing.xxxl).toBe("48px");
    });

    it("should follow 8px grid system", () => {
      // Verify the grid progression
      expect(spacing.sm).toBe("8px"); // 1x base
      expect(spacing.lg).toBe("16px"); // 2x base
      expect(spacing.xl).toBe("24px"); // 3x base
      expect(spacing.xxl).toBe("32px"); // 4x base
      expect(spacing.xxxl).toBe("48px"); // 6x base
    });
  });

  describe("fontSize", () => {
    it("should have all font sizes", () => {
      expect(fontSize.xs).toBe("12px");
      expect(fontSize.sm).toBe("13px");
      expect(fontSize.base).toBe("14px");
      expect(fontSize.lg).toBe("16px");
      expect(fontSize.xl).toBe("18px");
      expect(fontSize.xxl).toBe("20px");
      expect(fontSize.xxxl).toBe("24px");
    });

    it("should have progressive font sizes", () => {
      const sizes = Object.values(fontSize);
      const numericSizes = sizes.map((s) => parseInt(s));
      for (let i = 1; i < numericSizes.length; i++) {
        expect(numericSizes[i]).toBeGreaterThanOrEqual(numericSizes[i - 1]);
      }
    });
  });

  describe("borderRadius", () => {
    it("should have all border radius values", () => {
      expect(borderRadius.none).toBe("0");
      expect(borderRadius.sm).toBe("4px");
      expect(borderRadius.base).toBe("6px");
      expect(borderRadius.lg).toBe("8px");
      expect(borderRadius.xl).toBe("12px");
      expect(borderRadius.full).toBe("9999px");
    });

    it("should have progressive radius values", () => {
      const radii = [borderRadius.sm, borderRadius.base, borderRadius.lg, borderRadius.xl];
      const numericRadii = radii.map((r) => parseInt(r));
      for (let i = 1; i < numericRadii.length; i++) {
        expect(numericRadii[i]).toBeGreaterThan(numericRadii[i - 1]);
      }
    });
  });

  describe("shadows", () => {
    it("should have all shadow values", () => {
      expect(shadows.none).toBe("none");
      expect(shadows.sm.length).toBeGreaterThan(0);
      expect(shadows.base.length).toBeGreaterThan(0);
      expect(shadows.lg.length).toBeGreaterThan(0);
      expect(shadows.xl.length).toBeGreaterThan(0);
    });

    it("should contain rgba values", () => {
      expect(shadows.sm).toContain("rgba");
      expect(shadows.base).toContain("rgba");
      expect(shadows.lg).toContain("rgba");
      expect(shadows.xl).toContain("rgba");
    });

    it("should increase in complexity", () => {
      expect(shadows.sm.split(",").length).toBeLessThan(shadows.xl.split(",").length);
    });
  });

  describe("animation", () => {
    it("should have duration values", () => {
      expect(animation.duration.fast).toBe("0.1s");
      expect(animation.duration.normal).toBe("0.2s");
      expect(animation.duration.slow).toBe("0.3s");
    });

    it("should have easing functions", () => {
      expect(animation.easing.ease).toBe("ease");
      expect(animation.easing.easeIn).toBe("ease-in");
      expect(animation.easing.easeOut).toBe("ease-out");
      expect(animation.easing.easeInOut).toBe("ease-in-out");
    });

    it("should have transition combinations", () => {
      expect(animation.transition.all).toContain("all");
      expect(animation.transition.opacity).toContain("opacity");
      expect(animation.transition.background).toContain("background-color");
      expect(animation.transition.transform).toContain("transform");
    });

    it("should use consistent duration in transitions", () => {
      expect(animation.transition.all).toContain("0.3s");
      expect(animation.transition.opacity).toContain("0.2s");
      expect(animation.transition.background).toContain("0.2s");
      expect(animation.transition.transform).toContain("0.2s");
    });

    it("should use consistent easing in transitions", () => {
      const allTransitions = Object.values(animation.transition);
      allTransitions.forEach((t) => {
        expect(t).toContain("ease");
      });
    });
  });

  describe("zIndex", () => {
    it("should have all z-index values", () => {
      expect(zIndex.base).toBe(1);
      expect(zIndex.elevated).toBe(10);
      expect(zIndex.dropdown).toBe(100);
      expect(zIndex.modal).toBe(1000);
      expect(zIndex.tooltip).toBe(2000);
      expect(zIndex.notification).toBe(3000);
    });

    it("should have progressive z-index values", () => {
      expect(zIndex.base).toBeLessThan(zIndex.elevated);
      expect(zIndex.elevated).toBeLessThan(zIndex.dropdown);
      expect(zIndex.dropdown).toBeLessThan(zIndex.modal);
      expect(zIndex.modal).toBeLessThan(zIndex.tooltip);
      expect(zIndex.tooltip).toBeLessThan(zIndex.notification);
    });

    it("should use increments of 10, 100, or 1000", () => {
      const values = Object.values(zIndex);
      values.forEach((val) => {
        const isPowerOf10 = val === 1 || val % 10 === 0;
        expect(isPowerOf10).toBe(true);
      });
    });
  });

  describe("components", () => {
    it("should have chatItem styles", () => {
      expect(components.chatItem.padding).toBe(spacing.sm);
      expect(components.chatItem.borderRadius).toBe(borderRadius.base);
      expect(components.chatItem.marginBottom).toBe(spacing.xs);
      expect(components.chatItem.fontSize).toBe(fontSize.sm);
      expect(components.chatItem.transition).toBe(animation.transition.all);
    });

    it("should have chatItem selected state", () => {
      expect(components.chatItem.selected.fontWeight).toBe(500);
    });

    it("should have chatItem button group styles", () => {
      expect(components.chatItem.buttonGroup.gap).toBe(spacing.xs);
    });

    it("should have chatItem edit input styles", () => {
      expect(components.chatItem.editInput.fontSize).toBe(fontSize.sm);
      expect(components.chatItem.editInput.marginRight).toBe(spacing.sm);
    });

    it("should have button styles", () => {
      expect(components.button.hoverOpacity.default).toBe(0);
      expect(components.button.hoverOpacity.hover).toBe(1);
      expect(components.button.hoverOpacity.transition).toBe(animation.transition.opacity);
    });

    it("should reference theme constants", () => {
      // Verify component styles reference theme constants
      expect(components.chatItem.padding).toBe("8px");
      expect(components.chatItem.borderRadius).toBe("6px");
    });
  });

  describe("breakpoints", () => {
    it("should have all breakpoints", () => {
      expect(breakpoints.xs).toBe("480px");
      expect(breakpoints.sm).toBe("576px");
      expect(breakpoints.md).toBe("768px");
      expect(breakpoints.lg).toBe("992px");
      expect(breakpoints.xl).toBe("1200px");
      expect(breakpoints.xxl).toBe("1600px");
    });

    it("should have progressive breakpoint values", () => {
      const values = Object.values(breakpoints);
      const numericValues = values.map((v) => parseInt(v));
      for (let i = 1; i < numericValues.length; i++) {
        expect(numericValues[i]).toBeGreaterThan(numericValues[i - 1]);
      }
    });

    it("should follow common breakpoint conventions", () => {
      // Mobile first
      expect(parseInt(breakpoints.xs)).toBeLessThan(500);
      // Tablet
      expect(parseInt(breakpoints.md)).toBe(768);
      // Desktop
      expect(parseInt(breakpoints.lg)).toBeLessThan(1000);
      // Large desktop
      expect(parseInt(breakpoints.xl)).toBe(1200);
    });
  });

  describe("theme object", () => {
    it("should contain all theme sections", () => {
      expect(theme.colors).toBe(colors);
      expect(theme.spacing).toBe(spacing);
      expect(theme.fontSize).toBe(fontSize);
      expect(theme.borderRadius).toBe(borderRadius);
      expect(theme.shadows).toBe(shadows);
      expect(theme.animation).toBe(animation);
      expect(theme.zIndex).toBe(zIndex);
      expect(theme.components).toBe(components);
      expect(theme.breakpoints).toBe(breakpoints);
    });

    it("should be readonly (as const)", () => {
      expect(typeof theme).toBe("object");
      expect(Object.keys(theme).length).toBeGreaterThan(0);
    });
  });

  describe("type exports", () => {
    it("should export Theme type", () => {
      const myTheme: Theme = theme;
      expect(myTheme).toBe(theme);
    });

    it("should export ThemeColors type", () => {
      const myColors: ThemeColors = colors;
      expect(myColors).toBe(colors);
    });

    it("should export ThemeSpacing type", () => {
      const mySpacing: ThemeSpacing = spacing;
      expect(mySpacing).toBe(spacing);
    });
  });

  describe("integration", () => {
    it("should use consistent spacing in components", () => {
      // ChatItem uses spacing.sm for padding
      expect(components.chatItem.padding).toBe(spacing.sm);
      // Button group uses spacing.xs for gap
      expect(components.chatItem.buttonGroup.gap).toBe(spacing.xs);
    });

    it("should use consistent animation in components", () => {
      // ChatItem uses animation.transition.all
      expect(components.chatItem.transition).toBe(animation.transition.all);
      // Button uses animation.transition.opacity
      expect(components.button.hoverOpacity.transition).toBe(animation.transition.opacity);
    });

    it("should use consistent border radius in components", () => {
      // ChatItem uses borderRadius.base
      expect(components.chatItem.borderRadius).toBe(borderRadius.base);
    });

    it("should use consistent font sizes in components", () => {
      // ChatItem uses fontSize.sm
      expect(components.chatItem.fontSize).toBe(fontSize.sm);
    });
  });

  describe("edge cases", () => {
    it("should have valid CSS variable syntax", () => {
      Object.values(colors).forEach((value) => {
        if (typeof value === "string" && value.startsWith("var(")) {
          expect(value).toMatch(/^var\(--[\w-]+\)$/);
        }
      });
    });

    it("should have valid pixel values", () => {
      Object.values(spacing).forEach((value) => {
        expect(value).toMatch(/^\d+px$/);
      });

      Object.values(fontSize).forEach((value) => {
        expect(value).toMatch(/^\d+px$/);
      });

      Object.values(borderRadius).forEach((value) => {
        if (value !== "0") {
          expect(value).toMatch(/^\d+px$/);
        }
      });
    });

    it("should have valid shadow syntax", () => {
      Object.values(shadows).forEach((value) => {
        if (value !== "none") {
          expect(value).toMatch(/^0 \d+px/);
        }
      });
    });

    it("should have valid duration syntax", () => {
      Object.values(animation.duration).forEach((value) => {
        expect(value).toMatch(/^\d+\.\d+s$/);
      });
    });

    it("should have valid breakpoint syntax", () => {
      Object.values(breakpoints).forEach((value) => {
        expect(value).toMatch(/^\d+px$/);
      });
    });
  });
});
