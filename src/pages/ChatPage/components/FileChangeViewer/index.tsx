import React, { useMemo, useState } from "react";
import { Button, Space, Typography, theme } from "antd";
import { useTranslation } from "react-i18next";

import {
  extractDiffStatsFromUnified,
  parseUnifiedDiffLines,
  parseUnifiedDiffSideBySideRows,
  type DiffLine,
  type FileChangeResultPayload,
  type SideBySideDiffRow,
} from "../../utils/resultFormatters";

const { Text } = Typography;

type DiffViewMode = "sideBySide" | "unified";

export interface FileChangeViewerProps {
  payload: FileChangeResultPayload;
  defaultViewMode?: DiffViewMode;
  showHeader?: boolean;
  showViewToggle?: boolean;
  compact?: boolean;
  height?: number | string;
  maxHeight?: number | string;
  unifiedLinesOverride?: DiffLine[];
}

const buildUnifiedLineStyle = (
  line: DiffLine,
  token: ReturnType<typeof theme.useToken>["token"],
  compact: boolean,
): React.CSSProperties => {
  const style: React.CSSProperties = {
    margin: 0,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontSize: compact ? 11 : token.fontSizeSM,
    lineHeight: compact ? 1.35 : 1.5,
    padding: compact ? "0 4px" : "0 8px",
    fontFamily: "Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  };

  if (line.kind === "add") {
    style.background = token.colorSuccessBg;
  } else if (line.kind === "remove") {
    style.background = token.colorErrorBg;
  } else if (line.kind === "modified_add") {
    style.background = token.colorWarningBg;
    style.borderLeft = `3px solid ${token.colorSuccess}`;
  } else if (line.kind === "modified_remove") {
    style.background = token.colorWarningBg;
    style.borderLeft = `3px solid ${token.colorError}`;
  } else if (line.kind === "hunk") {
    style.background = token.colorFillSecondary;
    style.color = token.colorTextSecondary;
  } else if (line.kind === "meta") {
    style.background = token.colorFillTertiary;
    style.color = token.colorTextSecondary;
  } else if (line.kind === "gap") {
    style.background = token.colorFillQuaternary;
    style.color = token.colorTextTertiary;
    style.textAlign = "center";
    style.fontStyle = "italic";
  }

  return style;
};

const getSideRowBackground = (
  kind: SideBySideDiffRow["kind"],
  side: "old" | "new",
  token: ReturnType<typeof theme.useToken>["token"],
): string | undefined => {
  if (kind === "remove" && side === "old") {
    return token.colorErrorBg;
  }
  if (kind === "add" && side === "new") {
    return token.colorSuccessBg;
  }
  if (kind === "modified") {
    return side === "old" ? token.colorErrorBg : token.colorSuccessBg;
  }
  if (kind === "context") {
    return undefined;
  }
  return undefined;
};

const getSideRowBorder = (
  kind: SideBySideDiffRow["kind"],
  side: "old" | "new",
  token: ReturnType<typeof theme.useToken>["token"],
): string | undefined => {
  if (kind === "modified") {
    return side === "old" ? `3px solid ${token.colorError}` : `3px solid ${token.colorSuccess}`;
  }
  return undefined;
};

const renderLineNumber = (value: number | undefined): string =>
  value == null ? "" : String(value);

const FileChangeViewer: React.FC<FileChangeViewerProps> = ({
  payload,
  defaultViewMode = "sideBySide",
  showHeader = true,
  showViewToggle = true,
  compact = false,
  height,
  maxHeight = 400,
  unifiedLinesOverride,
}) => {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const [viewMode, setViewMode] = useState<DiffViewMode>(defaultViewMode);

  const diffStats = useMemo(() => {
    const fallback = extractDiffStatsFromUnified(payload.diff.unified);
    return {
      added: payload.diff.added_lines ?? fallback.added,
      removed: payload.diff.removed_lines ?? fallback.removed,
    };
  }, [payload]);

  const unifiedLines = useMemo(
    () => unifiedLinesOverride ?? parseUnifiedDiffLines(payload.diff.unified),
    [payload.diff.unified, unifiedLinesOverride],
  );
  const sideBySideRows = useMemo(
    () => parseUnifiedDiffSideBySideRows(payload.diff.unified),
    [payload.diff.unified],
  );

  const hasExplicitHeight = height !== undefined;

  const rootStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: compact ? 6 : token.marginSM,
    minHeight: 0,
    height: hasExplicitHeight ? height : undefined,
  };

  const surfaceStyle: React.CSSProperties = {
    border: `1px solid ${token.colorBorderSecondary}`,
    borderRadius: compact ? 6 : token.borderRadiusSM,
    overflow: "auto",
    background: token.colorBgContainer,
    minHeight: 0,
    flex: hasExplicitHeight ? 1 : undefined,
    maxHeight: hasExplicitHeight ? undefined : maxHeight,
  };

  const toggleSize = compact ? "small" : "middle";

  return (
    <div style={rootStyle}>
      {showHeader && (
        <div style={{ display: "grid", gap: compact ? 2 : token.marginXS }}>
          {payload.message ? (
            <Text style={{ fontSize: compact ? 11 : token.fontSizeSM }}>{payload.message}</Text>
          ) : null}
          <Space size={compact ? 2 : 8} wrap>
            <Text style={{ fontSize: compact ? 11 : token.fontSizeSM }}>
              <Text strong>{t("common.file")}:</Text> <Text code>{payload.file_path}</Text>
            </Text>
            {payload.workspace ? (
              <Text style={{ fontSize: compact ? 11 : token.fontSizeSM }}>
                <Text strong>{t("common.workspace")}:</Text> <Text code>{payload.workspace}</Text>
              </Text>
            ) : null}
            <Text
              style={{
                color: token.colorSuccess,
                fontSize: compact ? 11 : token.fontSizeSM,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              +{diffStats.added}
            </Text>
            <Text
              style={{
                color: token.colorError,
                fontSize: compact ? 11 : token.fontSizeSM,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              -{diffStats.removed}
            </Text>
          </Space>
          {payload.checkpoint?.created ? (
            <Text style={{ fontSize: compact ? token.fontSizeSM - 1 : token.fontSizeSM }}>
              <Text strong>{t("components.toolResult.checkpoint")}:</Text>{" "}
              <Text code>{payload.checkpoint.path}</Text>
            </Text>
          ) : (
            <Text type="secondary" style={{ fontSize: compact ? 11 : token.fontSizeSM }}>
              {t("components.toolResult.checkpointNone")}
            </Text>
          )}
        </div>
      )}

      {showViewToggle ? (
        <Space size={compact ? 2 : 8} wrap>
          <Button
            size={toggleSize}
            type={viewMode === "sideBySide" ? "primary" : "default"}
            onClick={() => setViewMode("sideBySide")}
          >
            {t("components.toolResult.sideBySide", { defaultValue: "Side by side" })}
          </Button>
          <Button
            size={toggleSize}
            type={viewMode === "unified" ? "primary" : "default"}
            onClick={() => setViewMode("unified")}
          >
            {t("components.toolResult.unified", { defaultValue: "Unified" })}
          </Button>
        </Space>
      ) : null}

      <div style={surfaceStyle}>
        {viewMode === "unified" ? (
          unifiedLines.length > 0 ? (
            unifiedLines.map((line, idx) => (
              <pre key={`${idx}-${line.kind}`} style={buildUnifiedLineStyle(line, token, compact)}>
                {line.text || " "}
              </pre>
            ))
          ) : (
            <Text
              type="secondary"
              style={{
                display: "block",
                padding: compact ? "4px" : "8px",
                fontSize: compact ? 11 : token.fontSizeSM,
              }}
            >
              {t("components.toolResult.noDiffPreview", {
                defaultValue: "No diff preview available.",
              })}
            </Text>
          )
        ) : sideBySideRows.length > 0 ? (
          <div>
            {sideBySideRows.map((row, idx) => {
              if (row.kind === "meta" || row.kind === "hunk") {
                return (
                  <pre
                    key={`meta-${idx}`}
                    style={{
                      margin: 0,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      fontSize: compact ? 11 : token.fontSizeSM,
                      lineHeight: compact ? 1.35 : 1.5,
                      padding: compact ? "2px 4px" : "4px 8px",
                      fontFamily:
                        "Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                      background:
                        row.kind === "meta" ? token.colorFillTertiary : token.colorFillSecondary,
                      color: token.colorTextSecondary,
                      borderBottom: `1px solid ${token.colorBorderSecondary}`,
                    }}
                  >
                    {row.text || " "}
                  </pre>
                );
              }

              const rowFontSize = compact ? 11 : token.fontSizeSM;
              const linePadding = compact ? "2px 4px" : "4px 8px";
              const lineNumberStyle: React.CSSProperties = {
                padding: linePadding,
                textAlign: "right",
                color: token.colorTextTertiary,
                fontFamily: "Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                fontSize: rowFontSize,
                borderRight: `1px solid ${token.colorBorderSecondary}`,
                userSelect: "none",
              };
              const lineTextStyle: React.CSSProperties = {
                padding: linePadding,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontFamily: "Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                fontSize: rowFontSize,
              };

              return (
                <div
                  key={`side-${idx}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: compact ? "48px 1fr 48px 1fr" : "64px 1fr 64px 1fr",
                    borderBottom: `1px solid ${token.colorBorderSecondary}`,
                  }}
                >
                  <div
                    style={{
                      ...lineNumberStyle,
                      background: getSideRowBackground(row.kind, "old", token),
                      borderLeft: getSideRowBorder(row.kind, "old", token),
                    }}
                  >
                    {renderLineNumber(row.oldLineNumber)}
                  </div>
                  <div
                    style={{
                      ...lineTextStyle,
                      background: getSideRowBackground(row.kind, "old", token),
                      borderRight: `1px solid ${token.colorBorderSecondary}`,
                      borderLeft: getSideRowBorder(row.kind, "old", token),
                    }}
                  >
                    {row.oldText ?? " "}
                  </div>
                  <div
                    style={{
                      ...lineNumberStyle,
                      background: getSideRowBackground(row.kind, "new", token),
                      borderLeft: getSideRowBorder(row.kind, "new", token),
                    }}
                  >
                    {renderLineNumber(row.newLineNumber)}
                  </div>
                  <div
                    style={{
                      ...lineTextStyle,
                      background: getSideRowBackground(row.kind, "new", token),
                      borderLeft: getSideRowBorder(row.kind, "new", token),
                    }}
                  >
                    {row.newText ?? " "}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <Text
            type="secondary"
            style={{
              display: "block",
              padding: compact ? "4px" : "8px",
              fontSize: compact ? 11 : token.fontSizeSM,
            }}
          >
            {t("components.toolResult.noDiffPreview", {
              defaultValue: "No diff preview available.",
            })}
          </Text>
        )}
      </div>

      {payload.diff.truncated ? (
        <Text type="secondary" style={{ fontSize: compact ? 11 : token.fontSizeSM }}>
          {t("components.toolResult.diffTruncated")}
        </Text>
      ) : null}
    </div>
  );
};

export default FileChangeViewer;
