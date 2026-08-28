import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useThemeStore } from "@shared/store/themeStore";
import { SYNTAX_THEME_BASE } from "./markdownSyntax";

// Keep the real React.lazy boundary suspended so these assertions exercise
// the exact PlainCodeBlock instance users see while the heavy chunk loads.
vi.mock("./markdownSyntaxHighlighter", () => new Promise(() => {}));

import { LazySyntaxHighlighter } from "./LazySyntaxHighlighter";

function expectFallbackTheme(
  element: HTMLPreElement | null,
  theme: (typeof SYNTAX_THEME_BASE)[keyof typeof SYNTAX_THEME_BASE],
) {
  expect(element).toHaveStyle({
    backgroundColor: theme.background,
    color: theme.color,
  });
}

describe("LazySyntaxHighlighter fallback theme", () => {
  beforeEach(() => {
    useThemeStore.setState({ themeMode: "light" });
  });

  afterEach(() => {
    cleanup();
  });

  it("uses the light base colors while the syntax chunk is loading", () => {
    const { container } = render(
      <LazySyntaxHighlighter language="typescript" codeString="const answer = 42;" />,
    );

    expectFallbackTheme(container.querySelector("pre"), SYNTAX_THEME_BASE.light);
  });

  it("uses the unchanged dark base colors when initially dark", () => {
    useThemeStore.setState({ themeMode: "dark" });
    const { container } = render(
      <LazySyntaxHighlighter language="typescript" codeString="const answer = 42;" />,
    );

    expectFallbackTheme(container.querySelector("pre"), SYNTAX_THEME_BASE.dark);
  });

  it("updates the mounted fallback when the app theme changes", () => {
    const { container } = render(
      <LazySyntaxHighlighter language="typescript" codeString="const answer = 42;" />,
    );
    const fallback = container.querySelector("pre");
    expectFallbackTheme(fallback, SYNTAX_THEME_BASE.light);

    act(() => {
      useThemeStore.getState().setThemeMode("dark");
    });

    expectFallbackTheme(fallback, SYNTAX_THEME_BASE.dark);
  });

  it("applies customStyle after fallback theme defaults", () => {
    const customStyle = {
      backgroundColor: "rgb(1, 2, 3)",
      color: "rgb(4, 5, 6)",
      padding: "3rem",
    };
    const { container } = render(
      <LazySyntaxHighlighter
        language="typescript"
        codeString="const answer = 42;"
        customStyle={customStyle}
      />,
    );

    expect(container.querySelector("pre")).toHaveStyle(customStyle);
  });
});
