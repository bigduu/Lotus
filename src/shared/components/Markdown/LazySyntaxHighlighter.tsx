// Shared Suspense/`React.lazy` wrapper around `./markdownSyntaxHighlighter`
// (PrismLight + the 10 registered languages + oneDark theme). Originally
// built for `MarkdownCodeBlock.tsx` (issue #7) and generalized here (issue
// #82) so every chat component that needs syntax highlighting shares one
// lazy boundary and one plain-text Suspense fallback instead of each
// eager-importing the full `Prism` build (~300 bundled languages).
//
// Don't add a static `import` of `./markdownSyntaxHighlighter` anywhere —
// that would defeat the lazy chunk boundary pinned for it in vite.config.ts.
import React from "react";
import {
  SYNTAX_THEME_BACKGROUND,
  SYNTAX_THEME_COLOR,
  SYNTAX_THEME_FONT_FAMILY,
} from "./markdownSyntax";
import type { MarkdownSyntaxHighlighterProps } from "./markdownSyntaxHighlighter";

const LazyHighlighterImpl = React.lazy(() => import("./markdownSyntaxHighlighter"));

export type LazySyntaxHighlighterProps = MarkdownSyntaxHighlighterProps;

// Suspense fallback shown while the highlighter chunk loads. Code can appear
// mid-stream, so this is styled close enough to the real oneDark-highlighted
// output (background/text color, font stack) that the swap-in isn't a
// jarring flash — see issue #7.
export const PlainCodeBlock: React.FC<{
  codeString: string;
  customStyle?: React.CSSProperties;
}> = ({ codeString, customStyle }) => (
  <pre
    style={{
      ...customStyle,
      background: SYNTAX_THEME_BACKGROUND,
      color: SYNTAX_THEME_COLOR,
      fontFamily: SYNTAX_THEME_FONT_FAMILY,
      lineHeight: 1.5,
      whiteSpace: "pre",
      overflow: "auto",
      padding: "1em",
    }}
  >
    <code>{codeString}</code>
  </pre>
);

// Single call site every consumer should use: wires the lazy highlighter
// chunk to its own Suspense boundary with the shared plain-text fallback, so
// a code block that appears mid-stream doesn't flash — it swaps from "plain
// colored text" to "syntax-highlighted text" once the chunk resolves.
export const LazySyntaxHighlighter: React.FC<LazySyntaxHighlighterProps> = (props) => (
  <React.Suspense
    fallback={<PlainCodeBlock codeString={props.codeString} customStyle={props.customStyle} />}
  >
    <LazyHighlighterImpl {...props} />
  </React.Suspense>
);
