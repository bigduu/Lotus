import React, { useMemo } from "react";
import type { ReactNode } from "react";
import { Empty, theme } from "antd";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

import { formatResultContent, safeStringify } from "../../utils/resultFormatters";

export type FormattedContentMode = "auto" | "json" | "text";

export interface FormattedContentPreviewProps {
  value?: unknown;
  mode?: FormattedContentMode;
  emptyDescription?: ReactNode;
  className?: string;
  height?: number | string;
  maxHeight?: number | string;
  compact?: boolean;
  scrollable?: boolean;
  backgroundColor?: string;
}

const normalizeContent = (value: unknown, mode: FormattedContentMode) => {
  if (value == null) {
    return {
      isJson: false,
      formattedText: "",
    };
  }

  if (mode === "json") {
    return {
      isJson: true,
      formattedText: typeof value === "string" ? value : safeStringify(value, 2),
    };
  }

  if (mode === "text") {
    return {
      isJson: false,
      formattedText: typeof value === "string" ? value : safeStringify(value, 2),
    };
  }

  if (typeof value === "string") {
    return formatResultContent(value);
  }

  return {
    isJson: true,
    formattedText: safeStringify(value, 2),
    parsedJson: value,
  };
};

const FormattedContentPreview: React.FC<FormattedContentPreviewProps> = ({
  value,
  mode = "auto",
  emptyDescription,
  className,
  height,
  maxHeight,
  compact = false,
  scrollable = true,
  backgroundColor,
}) => {
  const { token } = theme.useToken();

  const normalized = useMemo(() => normalizeContent(value, mode), [value, mode]);
  const text = normalized.formattedText ?? "";

  if (!text.trim()) {
    return emptyDescription === undefined ? null : <Empty description={emptyDescription} />;
  }

  const fontSize = compact ? Math.max(token.fontSizeSM - 1, 11) : token.fontSizeSM;
  const surfaceClassName = ["lotus-code-surface", className].filter(Boolean).join(" ");
  const surfaceStyle: React.CSSProperties = {
    backgroundColor:
      backgroundColor ?? (compact ? token.colorFillTertiary : token.colorBgContainer),
    borderRadius: token.borderRadiusSM,
    height,
    maxHeight,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    overflow: scrollable ? "auto" : "hidden",
  };

  if (normalized.isJson) {
    return (
      <div className={surfaceClassName} style={surfaceStyle}>
        <SyntaxHighlighter
          language="json"
          style={oneDark}
          wrapLongLines={true}
          customStyle={{
            margin: 0,
            backgroundColor: "transparent",
            fontSize,
            padding: compact ? token.paddingXS : token.paddingSM,
            minHeight: height ? "100%" : undefined,
            flex: height ? 1 : undefined,
          }}
          codeTagProps={{
            style: {
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            },
          }}
        >
          {text}
        </SyntaxHighlighter>
      </div>
    );
  }

  return (
    <div className={surfaceClassName} style={surfaceStyle}>
      <pre
        style={{
          margin: 0,
          padding: compact ? token.paddingXS : token.paddingSM,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          minHeight: height ? "100%" : undefined,
          flex: height ? 1 : undefined,
        }}
      >
        {text}
      </pre>
    </div>
  );
};

export default FormattedContentPreview;
