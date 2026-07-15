import type { GlobalToken } from "antd/es/theme/interface";
import React, { useState } from "react";
import { App as AntApp, Button, Card } from "antd";
import { CopyOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import LazyMermaidChart from "../MermaidChart/LazyMermaidChart";
import MermaidChart from "../MermaidChart";
import StaticMermaidChart from "../MermaidChart/StaticMermaidChart";
import { copyText } from "@shared/utils/clipboard";
import { getSyntaxTheme, registeredLanguages, SyntaxHighlighter } from "./markdownSyntax";

export type MermaidRenderMode = "lazy" | "eager" | "static";

interface CodeBlockWithCopyProps {
  language: string;
  codeString: string;
  token?: GlobalToken;
}

// eslint-disable-next-line react-refresh/only-export-components -- utility component intentionally colocated with render helper
const CodeBlockWithCopy: React.FC<CodeBlockWithCopyProps> = ({ language, codeString, token }) => {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isButtonHovered, setIsButtonHovered] = useState(false);
  // The copy button must always exist in the DOM (not conditionally
  // rendered) so keyboard users can Tab to it; opacity/pointer-events are
  // used to keep it visually hidden until hover or focus reveals it.
  const showCopyButton = isHovered || isFocused;
  const copyButtonOpacity = !showCopyButton ? 0 : isButtonHovered ? 1 : 0.8;

  // Stable layout values — fall back to constants when token absent (theme-change resilience)
  const marginXS = token?.marginXS ?? 8;
  const borderRadiusSM = token?.borderRadiusSM ?? 4;
  const fontSizeSM = token?.fontSizeSM ?? 12;
  const paddingSM = token?.paddingSM ?? 8;

  const handleCopy = async () => {
    try {
      await copyText(codeString);
      message.success(t("components.markdown.codeCopiedSuccess"));
    } catch (error) {
      console.error("Copy failed:", error);
      message.error(t("components.markdown.copyFailed"));
    }
  };

  const normalizedLanguage = language.toLowerCase();
  const isSupported = registeredLanguages.includes(normalizedLanguage);

  return (
    <Card
      size="small"
      styles={{ body: { padding: 0 } }}
      style={{
        position: "relative",
        maxWidth: "100%",
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        style={{
          maxHeight: "60vh",
          overflow: "auto",
        }}
      >
        <SyntaxHighlighter
          style={getSyntaxTheme()}
          language={isSupported ? normalizedLanguage : "text"}
          PreTag="div"
          customStyle={{
            margin: `${marginXS}px 0`,
            borderRadius: borderRadiusSM,
            fontSize: fontSizeSM,
            maxWidth: "100%",
            paddingRight: "50px",
          }}
          showLineNumbers={codeString.split("\n").length > 10}
          wrapLines={true}
          wrapLongLines={true}
        >
          {codeString}
        </SyntaxHighlighter>
      </div>

      <Button
        type="text"
        size="small"
        icon={<CopyOutlined />}
        onClick={handleCopy}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        aria-label={t("components.markdown.copyCodeAriaLabel")}
        style={{
          position: "absolute",
          top: paddingSM,
          right: paddingSM,
          backgroundColor: "var(--lotus-code-copy-btn-bg, rgba(0, 0, 0, 0.6))",
          color: "var(--lotus-code-copy-btn-color, white)",
          border: "none",
          borderRadius: borderRadiusSM,
          opacity: copyButtonOpacity,
          pointerEvents: showCopyButton ? "auto" : "none",
          transition: "opacity 0.2s",
          zIndex: 10,
        }}
        onMouseEnter={() => setIsButtonHovered(true)}
        onMouseLeave={() => setIsButtonHovered(false)}
      />
    </Card>
  );
};

// Fallback component for syntax highlighting errors
// eslint-disable-next-line react-refresh/only-export-components -- utility component intentionally colocated with render helper
const FallbackCodeBlock: React.FC<{
  codeString: string;
  token?: GlobalToken;
}> = ({ codeString, token }) => {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  // The copy button must always exist in the DOM (not toggled via
  // display:none) so keyboard users can Tab to it; opacity/pointer-events
  // keep it visually hidden until hover or focus reveals it.
  const showCopyButton = isHovered || isFocused;

  // Stable layout values — fall back to constants when token absent
  const marginXS = token?.marginXS ?? 8;
  const borderRadiusSM = token?.borderRadiusSM ?? 4;
  const fontSizeSM = token?.fontSizeSM ?? 12;
  const paddingSM = token?.paddingSM ?? 8;
  const padding = token?.padding ?? 16;

  return (
    <Card
      size="small"
      styles={{ body: { padding: 0 } }}
      style={{
        position: "relative",
        margin: `${marginXS}px 0`,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <pre
        style={{
          backgroundColor: "var(--ant-color-bg-container, #ffffff)",
          border: "1px solid var(--ant-color-border, #d9d9d9)",
          padding: padding,
          borderRadius: borderRadiusSM,
          overflow: "auto",
          fontSize: fontSizeSM,
          paddingRight: "50px",
          margin: 0,
        }}
      >
        <code style={{ color: "var(--ant-color-text, #333)" }}>{codeString}</code>
      </pre>
      <Button
        type="text"
        size="small"
        icon={<CopyOutlined />}
        aria-label={t("components.markdown.copyCodeAriaLabel")}
        className="fallback-copy-btn"
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        onClick={async () => {
          try {
            await copyText(codeString);
            message.success(t("components.markdown.codeCopiedSuccess"));
          } catch (error) {
            console.error("Copy failed:", error);
            message.error(t("components.markdown.copyFailed"));
          }
        }}
        style={{
          position: "absolute",
          top: paddingSM,
          right: paddingSM,
          backgroundColor: "var(--lotus-code-copy-btn-bg, rgba(0, 0, 0, 0.6))",
          color: "var(--lotus-code-copy-btn-color, white)",
          border: "none",
          borderRadius: borderRadiusSM,
          opacity: showCopyButton ? 1 : 0,
          pointerEvents: showCopyButton ? "auto" : "none",
          transition: "opacity 0.2s",
          zIndex: 10,
        }}
      />
    </Card>
  );
};

const MERMAID_LANGUAGE_HEADERS: Record<string, string> = {
  mermaid: "mermaid",
  graph: "graph TD",
  flowchart: "flowchart TD",
  sequencediagram: "sequenceDiagram",
  classdiagram: "classDiagram",
  statediagram: "stateDiagram-v2",
  "statediagram-v2": "stateDiagram-v2",
  erdiagram: "erDiagram",
  journey: "journey",
  gantt: "gantt",
  pie: "pie",
  gitgraph: "gitGraph",
  mindmap: "mindmap",
  timeline: "timeline",
  quadrantchart: "quadrantChart",
  requirementdiagram: "requirementDiagram",
  c4context: "C4Context",
  c4container: "C4Container",
  c4component: "C4Component",
  c4dynamic: "C4Dynamic",
  c4deployment: "C4Deployment",
  sankey: "sankey-beta",
  "sankey-beta": "sankey-beta",
  xychart: "xychart-beta",
  "xychart-beta": "xychart-beta",
  block: "block-beta",
  "block-beta": "block-beta",
  packet: "packet-beta",
  "packet-beta": "packet-beta",
  kanban: "kanban",
  architecture: "architecture",
};

const MERMAID_INIT_RE = /^(\s*%%\{[\s\S]*?\}%%\s*)+/;
const MERMAID_HEADER_RE =
  /^(graph|flowchart|sequencediagram|classdiagram|statediagram(?:-v2)?|erdiagram|journey|gantt|pie|gitgraph|mindmap|timeline|quadrantchart|requirementdiagram|c4context|c4container|c4component|c4dynamic|c4deployment|sankey-beta|xychart-beta|block-beta|packet-beta|kanban|architecture)\b/i;

const stripMermaidDirectives = (input: string) => input.replace(MERMAID_INIT_RE, "").trimStart();

const prependMermaidHeader = (input: string, header: string) => {
  const directiveMatch = input.match(MERMAID_INIT_RE);
  if (!directiveMatch) {
    return `${header}\n${input}`.trim();
  }

  const directiveBlock = directiveMatch[0].trimEnd();
  const rest = input.slice(directiveMatch[0].length).trimStart();
  if (!rest) {
    return `${directiveBlock}\n${header}`;
  }
  return `${directiveBlock}\n${header}\n${rest}`;
};

const toMermaidChart = (language: string, codeString: string): string | null => {
  const header = MERMAID_LANGUAGE_HEADERS[language];
  if (!header) {
    return null;
  }

  const trimmed = codeString.trim();
  if (!trimmed) {
    return "";
  }

  if (language === "mermaid") {
    return trimmed;
  }

  const body = stripMermaidDirectives(trimmed);
  if (MERMAID_HEADER_RE.test(body)) {
    return trimmed;
  }

  return prependMermaidHeader(trimmed, header);
};

export const renderCodeBlock = (
  language: string,
  codeString: string,
  token?: Partial<GlobalToken>,
  onFixMermaid?: (chart: string, renderError?: string) => Promise<void> | void,
  mermaidRenderMode: MermaidRenderMode = "lazy",
) => {
  try {
    if (!codeString || typeof codeString !== "string") {
      console.warn("Invalid codeString provided to renderCodeBlock:", codeString);
      return null;
    }

    const normalizedLanguage = language.toLowerCase().trim();
    const mermaidChart = toMermaidChart(normalizedLanguage, codeString);

    if (mermaidChart !== null) {
      const trimmedChart = mermaidChart.trim();
      if (!trimmedChart) {
        console.warn("Empty Mermaid chart content");
        return null;
      }
      if (mermaidRenderMode === "static") {
        return <StaticMermaidChart chart={trimmedChart} />;
      }
      if (mermaidRenderMode === "eager") {
        return <MermaidChart chart={trimmedChart} onFix={onFixMermaid} />;
      }
      return <LazyMermaidChart chart={trimmedChart} onFix={onFixMermaid} />;
    }

    return (
      <CodeBlockWithCopy
        language={normalizedLanguage}
        codeString={codeString}
        token={token as GlobalToken | undefined}
      />
    );
  } catch (error) {
    console.warn("Syntax highlighting failed:", error);
    return <FallbackCodeBlock codeString={codeString} token={token as GlobalToken | undefined} />;
  }
};
