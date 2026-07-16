// NOTE: This module intentionally imports NOTHING from
// `react-syntax-highlighter`. It used to eager-import PrismLight plus every
// registered language, which pulled the entire highlighter into whatever
// chunk rendered Markdown — the critical chat path (see issue #7). The
// highlighter itself now lives in `./markdownSyntaxHighlighter`, loaded via
// `React.lazy` from `MarkdownCodeBlock.tsx` so it ships as its own async
// chunk instead of shipping eagerly.
//
// This file keeps only the plain-data bits that callers need synchronously
// (before the highlighter chunk has loaded): the list of language aliases we
// register, and the theme's base colors so the Suspense fallback can be
// styled close enough to the real thing that swap-in isn't jarring.

export const registeredLanguages = [
  "javascript",
  "js",
  "typescript",
  "ts",
  "python",
  "py",
  "json",
  "bash",
  "shell",
  "sh",
  "css",
  "html",
  "xml",
  "sql",
  "yaml",
  "yml",
  "markdown",
  "md",
];

// Pulled from react-syntax-highlighter's `oneDark` Prism theme
// (`pre[class*="language-"]`) so the plain fallback can match its
// background/text color without importing the theme module eagerly.
export const SYNTAX_THEME_BACKGROUND = "hsl(220, 13%, 18%)";
export const SYNTAX_THEME_COLOR = "hsl(220, 14%, 71%)";
export const SYNTAX_THEME_FONT_FAMILY =
  '"Fira Code", "Fira Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace';
