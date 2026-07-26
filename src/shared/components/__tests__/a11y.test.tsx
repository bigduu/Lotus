import { act, fireEvent, render, screen } from "@testing-library/react";
import { App as AntdApp, theme as antdTheme } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ResizableSplit } from "../ResizableSplit/ResizableSplit";
import { CommandPalette } from "../CommandPalette";
import MermaidChartError from "../MermaidChart/MermaidChartError";
import MermaidChartViewer from "../MermaidChart/MermaidChartViewer";
import { useAppStore } from "@shared/store/appStore";
import { changeLocale } from "@shared/i18n";

const { defaultAlgorithm, defaultSeed } = antdTheme;
const testToken = { ...defaultSeed, ...defaultAlgorithm(defaultSeed) };

// jsdom does not implement scrollIntoView.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("a11y collection (#167)", () => {
  describe("ResizableSplit separator keyboard operation", () => {
    const originalResizeObserver = globalThis.ResizeObserver;

    beforeEach(() => {
      (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = undefined;
      vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => 1200);
      vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => 800);
    });

    afterEach(() => {
      vi.restoreAllMocks();
      (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
        originalResizeObserver;
    });

    it("separator is focusable with ARIA value attributes", () => {
      render(
        <ResizableSplit
          layout="horizontal"
          sizesPx={[600, 600]}
          minFirstPx={240}
          minSecondPx={240}
          first={<div>left</div>}
          second={<div>right</div>}
        />,
      );

      const separator = screen.getByRole("separator");
      expect(separator).toHaveAttribute("tabindex", "0");
      expect(separator).toHaveAttribute("aria-valuenow", "600");
      expect(separator).toHaveAttribute("aria-valuemin", "240");
      expect(separator).toHaveAttribute("aria-valuemax", "960");
    });

    it("arrow keys adjust the split (±10, Shift ±50) and commit via onResizeEnd", () => {
      const onResizeEnd = vi.fn();
      render(
        <ResizableSplit
          layout="horizontal"
          sizesPx={[600, 600]}
          minFirstPx={240}
          minSecondPx={240}
          first={<div>left</div>}
          second={<div>right</div>}
          onResizeEnd={onResizeEnd}
        />,
      );

      const separator = screen.getByRole("separator");
      fireEvent.keyDown(separator, { key: "ArrowRight" });
      expect(onResizeEnd).toHaveBeenLastCalledWith([610, 590]);

      fireEvent.keyDown(separator, { key: "ArrowLeft", shiftKey: true });
      expect(onResizeEnd).toHaveBeenLastCalledWith([560, 640]);

      // Clamped at minFirstPx.
      onResizeEnd.mockClear();
      for (let i = 0; i < 40; i += 1) {
        fireEvent.keyDown(separator, { key: "ArrowLeft", shiftKey: true });
      }
      expect(onResizeEnd).toHaveBeenLastCalledWith([240, 960]);
    });
  });

  describe("CommandPalette listbox semantics", () => {
    beforeEach(() => {
      useAppStore.setState((state) => ({
        ...state,
        chats: [],
        systemPrompts: [],
        executionBySession: {},
      }));
      (
        window as typeof window & { __LOTUS_COMMAND_PALETTE_FORCE_OPEN__?: boolean }
      ).__LOTUS_COMMAND_PALETTE_FORCE_OPEN__ = true;
    });

    it("renders options with role=option + aria-selected and wires aria-activedescendant", async () => {
      render(
        <AntdApp>
          <CommandPalette />
        </AntdApp>,
      );

      const listbox = await screen.findByRole("listbox");
      const options = screen.getAllByRole("option");
      expect(options.length).toBeGreaterThan(0);
      expect(options[0]).toHaveAttribute("aria-selected", "true");
      expect(options[1]).toHaveAttribute("aria-selected", "false");

      const combobox = screen.getByRole("combobox");
      expect(combobox.getAttribute("aria-activedescendant")).toBe(options[0].id);
      expect(listbox.id).toBeTruthy();
    });
  });

  describe("MermaidChartError", () => {
    it("exposes a keyboard-scrollable region instead of a title-only tooltip", () => {
      render(
        <MermaidChartError
          error="line 1\nline 2\nline 3"
          token={testToken}
          isFixing={false}
          fixError=""
        />,
      );

      const region = screen.getByRole("region");
      expect(region).toHaveAttribute("tabindex", "0");
      expect(region).toHaveAttribute("aria-label");
    });
  });

  describe("MermaidChartViewer zoom controls", () => {
    it("zoom in/out/reset buttons all have accessible names", () => {
      render(
        <AntdApp>
          <MermaidChartViewer
            svg={'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" />'}
            height={240}
            isLoading={false}
            initialScale={1}
            token={testToken}
            containerRef={{ current: null }}
          />
        </AntdApp>,
      );

      expect(screen.getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Zoom out" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Reset zoom" })).toBeInTheDocument();
    });
  });

  describe("html lang sync", () => {
    it("syncs <html lang> with the locale resolved at startup (init path)", async () => {
      const { default: i18n, i18nReady } = await import("@shared/i18n");
      await i18nReady;
      expect(document.documentElement.lang).toBe(i18n.language);
    });

    it("changeLocale updates document.documentElement.lang", async () => {
      const original = document.documentElement.lang;
      try {
        await act(async () => {
          await changeLocale("zh-CN" as Parameters<typeof changeLocale>[0]);
        });
        expect(document.documentElement.lang).toBe("zh-CN");

        await act(async () => {
          await changeLocale("en-US" as Parameters<typeof changeLocale>[0]);
        });
        expect(document.documentElement.lang).toBe("en-US");
      } finally {
        document.documentElement.lang = original;
      }
    });
  });
});
