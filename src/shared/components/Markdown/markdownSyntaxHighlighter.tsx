// This module is the real weight of syntax highlighting: PrismLight (the
// "light" build — no bundled languages) plus a hand-picked set of language
// grammars and the oneLight/oneDark themes. It is loaded exclusively via
// `React.lazy(() => import("./markdownSyntaxHighlighter"))` from
// `MarkdownCodeBlock.tsx`, so it ships as its own async chunk instead of
// shipping eagerly on the critical chat-render path (issue #7). Don't add a
// static `import` of this file anywhere — that would defeat the point.
import type { CSSProperties } from "react";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-light";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import html from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import type { SyntaxThemeMode } from "./markdownSyntax";

SyntaxHighlighter.registerLanguage("javascript", javascript);
SyntaxHighlighter.registerLanguage("js", javascript);
SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("ts", typescript);
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("py", python);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("shell", bash);
SyntaxHighlighter.registerLanguage("sh", bash);
SyntaxHighlighter.registerLanguage("css", css);
SyntaxHighlighter.registerLanguage("html", html);
SyntaxHighlighter.registerLanguage("xml", html);
SyntaxHighlighter.registerLanguage("sql", sql);
SyntaxHighlighter.registerLanguage("yaml", yaml);
SyntaxHighlighter.registerLanguage("yml", yaml);
SyntaxHighlighter.registerLanguage("markdown", markdown);
SyntaxHighlighter.registerLanguage("md", markdown);

export interface MarkdownSyntaxHighlighterProps {
  language: string;
  codeString: string;
  /** Selected by `LazySyntaxHighlighter`; callers do not set this directly. */
  themeMode: SyntaxThemeMode;
  customStyle?: CSSProperties;
  showLineNumbers?: boolean;
  // Forwarded verbatim to the underlying `<SyntaxHighlighter>` — needed by
  // callers outside MarkdownCodeBlock (issue #82) that render their own
  // wrap/whitespace rules (e.g. ToolCallCard's live-output panel) or embed
  // the highlighter inside markup that already supplies a `<pre>` ancestor
  // (e.g. SystemPromptPreview's react-markdown `code` override).
  codeTagProps?: React.HTMLProps<HTMLElement>;
  PreTag?: React.ElementType;
  className?: string;
}

// Default export — required for `React.lazy`, which expects the resolved
// module to have a `default` export of a component.
const MarkdownSyntaxHighlighter: React.FC<MarkdownSyntaxHighlighterProps> = ({
  language,
  codeString,
  themeMode,
  customStyle,
  showLineNumbers = false,
  codeTagProps,
  PreTag = "div",
  className,
}) => (
  <SyntaxHighlighter
    style={themeMode === "dark" ? oneDark : oneLight}
    language={language}
    PreTag={PreTag}
    customStyle={customStyle}
    showLineNumbers={showLineNumbers}
    wrapLines={true}
    wrapLongLines={true}
    codeTagProps={codeTagProps}
    className={className}
  >
    {codeString}
  </SyntaxHighlighter>
);

export default MarkdownSyntaxHighlighter;
