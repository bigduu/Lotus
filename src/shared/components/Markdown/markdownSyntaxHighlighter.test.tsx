import type React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useThemeStore } from "@shared/store/themeStore";
import { SYNTAX_THEME_BASE, SYNTAX_THEME_FONT_FAMILY } from "./markdownSyntax";

type CapturedHighlighterProps = {
  style?: unknown;
  customStyle?: React.CSSProperties;
  children?: React.ReactNode;
};

const highlighterMocks = vi.hoisted(() => ({
  render: vi.fn<(props: CapturedHighlighterProps) => void>(),
  registerLanguage: vi.fn(),
}));

vi.mock("react-syntax-highlighter/dist/esm/prism-light", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");
  const MockSyntaxHighlighter = Object.assign(
    (props: CapturedHighlighterProps) => {
      highlighterMocks.render(props);
      return ReactModule.createElement(
        "pre",
        { "data-testid": "syntax-highlighter" },
        props.children,
      );
    },
    { registerLanguage: highlighterMocks.registerLanguage },
  );

  return { default: MockSyntaxHighlighter };
});

import { LazySyntaxHighlighter } from "./LazySyntaxHighlighter";
import MarkdownSyntaxHighlighter from "./markdownSyntaxHighlighter";

type PrismTheme = Record<string, React.CSSProperties>;

function lastHighlighterProps(): CapturedHighlighterProps {
  const props = highlighterMocks.render.mock.calls.at(-1)?.[0];
  expect(props).toBeDefined();
  return props!;
}

describe("MarkdownSyntaxHighlighter theme selection", () => {
  beforeEach(() => {
    highlighterMocks.render.mockClear();
    useThemeStore.setState({ themeMode: "light" });
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps the synchronous base map aligned with the real Prism themes", () => {
    const oneLightPre = (oneLight as PrismTheme)['pre[class*="language-"]'];
    const oneDarkPre = (oneDark as PrismTheme)['pre[class*="language-"]'];

    expect(SYNTAX_THEME_BASE.light).toEqual({
      background: oneLightPre.background,
      color: oneLightPre.color,
    });
    expect(SYNTAX_THEME_BASE.dark).toEqual({
      background: oneDarkPre.background,
      color: oneDarkPre.color,
    });
    expect(SYNTAX_THEME_FONT_FAMILY).toBe(oneLightPre.fontFamily);
    expect(SYNTAX_THEME_FONT_FAMILY).toBe(oneDarkPre.fontFamily);
    expect(SYNTAX_THEME_BASE.light).toEqual({
      background: "hsl(230, 1%, 98%)",
      color: "hsl(230, 8%, 24%)",
    });
    expect(SYNTAX_THEME_BASE.dark).toEqual({
      background: "hsl(220, 13%, 18%)",
      color: "hsl(220, 14%, 71%)",
    });
  });

  it("passes the real oneLight and oneDark objects to Prism", () => {
    const { rerender } = render(
      <MarkdownSyntaxHighlighter
        language="typescript"
        codeString="const answer = 42;"
        themeMode="light"
      />,
    );
    expect(lastHighlighterProps().style).toBe(oneLight);

    rerender(
      <MarkdownSyntaxHighlighter
        language="typescript"
        codeString="const answer = 42;"
        themeMode="dark"
      />,
    );
    expect(lastHighlighterProps().style).toBe(oneDark);
  });

  it("updates the lazy implementation with the same live store theme", async () => {
    render(<LazySyntaxHighlighter language="typescript" codeString="const answer = 42;" />);

    await waitFor(() => {
      expect(lastHighlighterProps().style).toBe(oneLight);
    });

    act(() => {
      useThemeStore.getState().setThemeMode("dark");
    });

    await waitFor(() => {
      expect(lastHighlighterProps().style).toBe(oneDark);
    });
  });

  it("forwards customStyle unchanged for Prism to merge after theme defaults", () => {
    const customStyle = {
      background: "rgb(1, 2, 3)",
      color: "rgb(4, 5, 6)",
    };
    render(
      <MarkdownSyntaxHighlighter
        language="typescript"
        codeString="const answer = 42;"
        themeMode="light"
        customStyle={customStyle}
      />,
    );

    expect(lastHighlighterProps().style).toBe(oneLight);
    expect(lastHighlighterProps().customStyle).toBe(customStyle);
  });
});
