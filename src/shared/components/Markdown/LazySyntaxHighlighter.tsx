// Shared Suspense/`React.lazy` wrapper around `./markdownSyntaxHighlighter`
// (PrismLight + the 10 registered languages + oneLight/oneDark themes). Originally
// built for `MarkdownCodeBlock.tsx` (issue #7) and generalized here (issue
// #82) so every chat component that needs syntax highlighting shares one
// lazy boundary and one plain-text Suspense fallback instead of each
// eager-importing the full `Prism` build (~300 bundled languages).
//
// Don't add a static `import` of `./markdownSyntaxHighlighter` anywhere —
// that would defeat the lazy chunk boundary pinned for it in vite.config.ts.
import React from "react";
import {
  SYNTAX_THEME_BASE,
  SYNTAX_THEME_FONT_FAMILY,
  type SyntaxThemeMode,
} from "./markdownSyntax";
import type { MarkdownSyntaxHighlighterProps } from "./markdownSyntaxHighlighter";
import { useThemeStore } from "@shared/store/themeStore";

const LazyHighlighterImpl = React.lazy(() => import("./markdownSyntaxHighlighter"));

export type LazySyntaxHighlighterProps = Omit<MarkdownSyntaxHighlighterProps, "themeMode">;

// Suspense fallback shown while the highlighter chunk loads. Code can appear
// mid-stream, so this is styled close enough to the selected highlighted
// output (background/text color, font stack) that the swap-in isn't a
// jarring flash — see issue #7.
export const PlainCodeBlock: React.FC<{
  codeString: string;
  themeMode: SyntaxThemeMode;
  customStyle?: React.CSSProperties;
}> = ({ codeString, themeMode, customStyle }) => {
  const theme = SYNTAX_THEME_BASE[themeMode];

  return (
    <pre
      style={{
        backgroundColor: theme.background,
        color: theme.color,
        fontFamily: SYNTAX_THEME_FONT_FAMILY,
        lineHeight: 1.5,
        whiteSpace: "pre",
        overflow: "auto",
        padding: "1em",
        ...customStyle,
      }}
    >
      <code>{codeString}</code>
    </pre>
  );
};

// Single call site every consumer should use: wires the lazy highlighter
// chunk to its own Suspense boundary with the shared plain-text fallback, so
// a code block that appears mid-stream doesn't flash — it swaps from "plain
// colored text" to "syntax-highlighted text" once the chunk resolves.
export const LazySyntaxHighlighter: React.FC<LazySyntaxHighlighterProps> = (props) => {
  const themeMode = useThemeStore((state) => state.themeMode);

  return (
    <React.Suspense
      fallback={
        <PlainCodeBlock
          codeString={props.codeString}
          themeMode={themeMode}
          customStyle={props.customStyle}
        />
      }
    >
      <LazyHighlighterImpl {...props} themeMode={themeMode} />
    </React.Suspense>
  );
};
