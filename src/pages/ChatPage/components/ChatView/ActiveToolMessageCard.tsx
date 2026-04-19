import React, { useEffect, useMemo, useState } from "react";
import { Card, theme } from "antd";
import { Space } from "@/components/ui/space";
import { Typography } from "@/components/ui/typography";
import { DiffOutlined, DownOutlined, RightOutlined } from "@ant-design/icons";
import { parseUnifiedDiffLines, type DiffLine } from "../../utils/resultFormatters";

const { Text } = Typography;

export type SessionDiffFileSummary = {
  filePath: string;
  added: number;
  removed: number;
  unifiedDiff: string;
  truncated?: boolean;
};

export type SessionDiffSummary = {
  totalAdded: number;
  totalRemoved: number;
  files: SessionDiffFileSummary[];
  changedTools: number;
};

type ActiveToolMessageCardProps = {
  sessionDiffSummary: SessionDiffSummary | null;
  sessionId?: string | null;
};

const EXIT_ANIMATION_MS = 220;
const DIFF_COLLAPSE_STORAGE_KEY_PREFIX = "chat-session-diff-collapse:";

const basename = (filePath: string): string => filePath.split(/[\\/]/).pop() || filePath;

interface PersistedCollapseState {
  isExpanded: boolean;
  expandedFiles: string[];
}

const getCollapseStorageKey = (sessionId?: string | null): string =>
  `${DIFF_COLLAPSE_STORAGE_KEY_PREFIX}${sessionId ?? "default"}`;

const readPersistedCollapseState = (sessionId?: string | null): PersistedCollapseState | null => {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(getCollapseStorageKey(sessionId));
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const isExpanded =
      "isExpanded" in parsed && typeof parsed.isExpanded === "boolean" ? parsed.isExpanded : true;
    const expandedFiles =
      "expandedFiles" in parsed && Array.isArray(parsed.expandedFiles)
        ? parsed.expandedFiles.filter((item): item is string => typeof item === "string")
        : [];

    return { isExpanded, expandedFiles };
  } catch {
    return null;
  }
};

const writePersistedCollapseState = (
  sessionId: string | null | undefined,
  state: PersistedCollapseState,
): void => {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(getCollapseStorageKey(sessionId), JSON.stringify(state));
  } catch {
    // Best-effort persistence only.
  }
};

export const ActiveToolMessageCard: React.FC<ActiveToolMessageCardProps> = ({
  sessionDiffSummary,
  sessionId,
}) => {
  const { token } = theme.useToken();
  const hasDiff = Boolean(sessionDiffSummary && sessionDiffSummary.files.length > 0);

  const [shouldRender, setShouldRender] = useState(hasDiff);
  const [isVisible, setIsVisible] = useState(hasDiff);
  const [isExpanded, setIsExpanded] = useState<boolean>(
    () => readPersistedCollapseState(sessionId)?.isExpanded ?? true,
  );
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(
    () => new Set(readPersistedCollapseState(sessionId)?.expandedFiles ?? []),
  );

  useEffect(() => {
    if (hasDiff) {
      setShouldRender(true);
      const id = window.setTimeout(() => setIsVisible(true), 0);
      return () => window.clearTimeout(id);
    }

    setIsVisible(false);
    const id = window.setTimeout(() => setShouldRender(false), EXIT_ANIMATION_MS);
    return () => window.clearTimeout(id);
  }, [hasDiff]);

  const fileRows = useMemo(() => {
    if (!sessionDiffSummary) return [];
    return sessionDiffSummary.files;
  }, [sessionDiffSummary]);

  const parsedDiffByFile = useMemo(() => {
    const map = new Map<string, DiffLine[]>();
    if (!sessionDiffSummary) {
      return map;
    }

    sessionDiffSummary.files.forEach((file) => {
      map.set(file.filePath, parseUnifiedDiffLines(file.unifiedDiff));
    });

    return map;
  }, [sessionDiffSummary]);

  useEffect(() => {
    const persisted = readPersistedCollapseState(sessionId);
    setIsExpanded(persisted?.isExpanded ?? true);
    setExpandedFiles(new Set(persisted?.expandedFiles ?? []));
  }, [sessionId]);

  useEffect(() => {
    writePersistedCollapseState(sessionId, {
      isExpanded,
      expandedFiles: Array.from(expandedFiles),
    });
  }, [sessionId, isExpanded, expandedFiles]);

  useEffect(() => {
    if (!sessionDiffSummary || sessionDiffSummary.files.length === 0) {
      return;
    }

    const fileKeys = new Set(sessionDiffSummary.files.map((file) => file.filePath));
    setExpandedFiles((previous) => {
      const next = new Set<string>();
      let changed = false;
      previous.forEach((key) => {
        if (fileKeys.has(key)) {
          next.add(key);
        } else {
          changed = true;
        }
      });

      if (!changed && next.size === previous.size) {
        return previous;
      }

      return next;
    });
  }, [sessionDiffSummary]);

  if (!shouldRender || !sessionDiffSummary) return null;

  return (
    <div
      className={`active-tool-card-wrapper ${isVisible ? "visible" : ""}`}
      aria-hidden={!isVisible}
      data-testid="session-diff-card"
    >
      <Card
        size="small"
        style={{
          width: "100%",
          borderRadius: token.borderRadiusLG,
          border: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
          boxShadow: token.boxShadowSecondary,
        }}
        bodyStyle={{ padding: `${token.paddingXS}px ${token.paddingSM}px` }}
      >
        <Space direction="vertical" style={{ width: "100%" }} size={6}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: token.marginSM,
              cursor: "pointer",
            }}
            onClick={() => setIsExpanded((prev) => !prev)}
            data-testid="session-diff-toggle"
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: token.marginSM,
                minWidth: 0,
              }}
            >
              <DiffOutlined style={{ color: token.colorPrimary }} />
              <Text strong style={{ whiteSpace: "nowrap" }}>
                Session diffs
              </Text>
              <Text type="secondary" style={{ fontSize: token.fontSizeSM, whiteSpace: "nowrap" }}>
                ({sessionDiffSummary.files.length} files / {sessionDiffSummary.changedTools} tools)
              </Text>
              <Space size={4} style={{ marginInlineStart: token.marginXS }}>
                <Text
                  style={{
                    color: token.colorSuccess,
                    fontSize: token.fontSizeSM,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  }}
                >
                  +{sessionDiffSummary.totalAdded}
                </Text>
                <Text
                  style={{
                    color: token.colorError,
                    fontSize: token.fontSizeSM,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  }}
                >
                  -{sessionDiffSummary.totalRemoved}
                </Text>
              </Space>
            </div>
            <div style={{ color: token.colorTextSecondary }}>
              {isExpanded ? <DownOutlined /> : <RightOutlined />}
            </div>
          </div>

          {isExpanded && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr",
                gap: 6,
                maxHeight: 280,
                overflowY: "auto",
              }}
              data-testid="session-diff-file-list"
            >
              {fileRows.map((file) => {
                const expanded = expandedFiles.has(file.filePath);
                const diffLines = parsedDiffByFile.get(file.filePath) ?? [];

                return (
                  <div
                    key={file.filePath}
                    style={{
                      border: `1px solid ${token.colorBorderSecondary}`,
                      borderRadius: token.borderRadiusSM,
                      overflow: "hidden",
                      background: token.colorBgContainer,
                    }}
                    data-testid="session-diff-file-item"
                    data-file-path={file.filePath}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: token.marginSM,
                        padding: "4px 8px",
                        borderRadius: token.borderRadiusSM,
                        background: token.colorFillTertiary,
                        cursor: "pointer",
                      }}
                      onClick={() => {
                        setExpandedFiles((previous) => {
                          const next = new Set(previous);
                          if (next.has(file.filePath)) {
                            next.delete(file.filePath);
                          } else {
                            next.add(file.filePath);
                          }
                          return next;
                        });
                      }}
                      data-testid="session-diff-file-header"
                      data-file-path={file.filePath}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: token.marginXS,
                          minWidth: 0,
                          flex: 1,
                        }}
                      >
                        <span style={{ color: token.colorTextSecondary }}>
                          {expanded ? <DownOutlined /> : <RightOutlined />}
                        </span>
                        <Text
                          ellipsis={{ tooltip: file.filePath }}
                          style={{ flex: 1, minWidth: 0, fontSize: token.fontSizeSM }}
                        >
                          {basename(file.filePath)}
                        </Text>
                      </div>
                      <Space size={4}>
                        <Text
                          style={{
                            color: token.colorSuccess,
                            fontSize: token.fontSizeSM,
                            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                          }}
                        >
                          +{file.added}
                        </Text>
                        <Text
                          style={{
                            color: token.colorError,
                            fontSize: token.fontSizeSM,
                            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                          }}
                        >
                          -{file.removed}
                        </Text>
                      </Space>
                    </div>

                    {expanded && (
                      <div
                        style={{
                          borderTop: `1px solid ${token.colorBorderSecondary}`,
                          maxHeight: 220,
                          overflow: "auto",
                          background: token.colorBgContainer,
                        }}
                        data-testid="session-diff-file-panel"
                        data-file-path={file.filePath}
                      >
                        {diffLines.length > 0 ? (
                          diffLines.map((line, index) => {
                            const lineStyle: React.CSSProperties = {
                              margin: 0,
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                              fontSize: token.fontSizeSM,
                              lineHeight: 1.5,
                              padding: "0 8px",
                              fontFamily:
                                "Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                            };

                            if (line.kind === "add") {
                              lineStyle.background = token.colorSuccessBg;
                            } else if (line.kind === "remove") {
                              lineStyle.background = token.colorErrorBg;
                            } else if (line.kind === "modified_add") {
                              lineStyle.background = token.colorWarningBg;
                              lineStyle.borderLeft = `3px solid ${token.colorSuccess}`;
                            } else if (line.kind === "modified_remove") {
                              lineStyle.background = token.colorWarningBg;
                              lineStyle.borderLeft = `3px solid ${token.colorError}`;
                            } else if (line.kind === "hunk") {
                              lineStyle.background = token.colorFillSecondary;
                              lineStyle.color = token.colorTextSecondary;
                            } else if (line.kind === "meta") {
                              lineStyle.background = token.colorFillTertiary;
                              lineStyle.color = token.colorTextSecondary;
                            }

                            return (
                              <pre
                                key={`${file.filePath}-${index}`}
                                style={lineStyle}
                                data-testid="session-diff-line"
                                data-kind={line.kind}
                              >
                                {line.text || " "}
                              </pre>
                            );
                          })
                        ) : (
                          <Text
                            type="secondary"
                            style={{
                              display: "block",
                              padding: "8px",
                              fontSize: token.fontSizeSM,
                            }}
                          >
                            No diff preview available.
                          </Text>
                        )}
                        {file.truncated && (
                          <Text
                            type="secondary"
                            style={{
                              display: "block",
                              padding: "6px 8px 8px",
                              fontSize: token.fontSizeSM,
                            }}
                          >
                            Diff truncated for display.
                          </Text>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Space>
      </Card>
    </div>
  );
};

export default ActiveToolMessageCard;
