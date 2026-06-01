import React, { useEffect, useMemo, useState } from "react";
import { Button, Card, Drawer, Flex, Space, Tag, Typography, theme } from "antd";
import { ArrowLeftOutlined, DiffOutlined, LeftOutlined, RightOutlined } from "@ant-design/icons";

import FileChangeViewer from "../FileChangeViewer";
import type { FileChangeResultPayload } from "@shared/utils/resultFormatters";
import InlineMetaText from "../../../../shared/components/InlineMetaText";

const { Text } = Typography;

export type SessionDiffFileSummary = {
  filePath: string;
  added: number;
  removed: number;
  unifiedDiff: string;
  truncated?: boolean;
  toolCount?: number;
  workspace?: string;
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
  compact?: boolean;
};

type SessionDiffSortMode = "magnitude" | "path";

const EXIT_ANIMATION_MS = 220;
const SESSION_DIFF_LIST_MAX_HEIGHT = 560;
const SESSION_DIFF_LIST_MAX_HEIGHT_COMPACT = 420;

const basename = (filePath: string): string => filePath.split(/[\\/]/).pop() || filePath;

const dirname = (filePath: string): string | null => {
  const normalized = filePath.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) {
    return null;
  }
  return normalized.slice(0, index);
};

const getChangeMagnitude = (file: SessionDiffFileSummary): number => file.added + file.removed;

const formatDiffCount = (value: number): string => value.toLocaleString();
const formatDiffDeltaPair = (added: number, removed: number): string =>
  `(+${formatDiffCount(added)} / -${formatDiffCount(removed)})`;

const buildViewerPayload = (file: SessionDiffFileSummary): FileChangeResultPayload => ({
  operation: "session_diff_review",
  file_path: file.filePath,
  workspace: file.workspace,
  diff: {
    unified: file.unifiedDiff,
    added_lines: file.added,
    removed_lines: file.removed,
    truncated: file.truncated,
  },
});

const sortFiles = (
  files: SessionDiffFileSummary[],
  sortMode: SessionDiffSortMode,
): SessionDiffFileSummary[] => {
  const next = [...files];

  if (sortMode === "path") {
    next.sort((a, b) => a.filePath.localeCompare(b.filePath));
    return next;
  }

  next.sort((a, b) => {
    const magnitudeDelta = getChangeMagnitude(b) - getChangeMagnitude(a);
    if (magnitudeDelta !== 0) {
      return magnitudeDelta;
    }
    return a.filePath.localeCompare(b.filePath);
  });
  return next;
};

const DiffDeltaText: React.FC<{
  value: number;
  kind: "added" | "removed";
  compact?: boolean;
}> = ({ value, kind, compact = false }) => {
  const { token } = theme.useToken();
  const isAdded = kind === "added";

  return (
    <Text
      style={{
        color: isAdded ? token.colorSuccess : token.colorError,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        whiteSpace: "nowrap",
        fontSize: compact ? 11 : undefined,
      }}
    >
      {isAdded ? "+" : "-"}
      {formatDiffCount(value)}
    </Text>
  );
};

const SessionDiffListView: React.FC<{
  files: SessionDiffFileSummary[];
  changedTools: number;
  totalAdded: number;
  totalRemoved: number;
  sortMode: SessionDiffSortMode;
  selectedFilePath: string | null;
  compact?: boolean;
  onSortModeChange: (mode: SessionDiffSortMode) => void;
  onSelectFile: (filePath: string) => void;
}> = ({
  files,
  changedTools,
  totalAdded,
  totalRemoved,
  sortMode,
  selectedFilePath,
  compact = false,
  onSortModeChange,
  onSelectFile,
}) => {
  const { token } = theme.useToken();

  const sortedFiles = useMemo(() => sortFiles(files, sortMode), [files, sortMode]);
  const truncatedCount = useMemo(() => files.filter((file) => file.truncated).length, [files]);
  const largestFile = useMemo(() => sortFiles(files, "magnitude")[0] ?? null, [files]);
  const compactTagStyle = compact
    ? { marginInlineEnd: 0, fontSize: 10, lineHeight: "16px", paddingInline: 6 }
    : { marginInlineEnd: 0 };
  const compactSummaryItems = useMemo(() => {
    const parts: string[] = [];
    if (largestFile) {
      parts.push(
        `Largest: ${basename(largestFile.filePath)} ${formatDiffDeltaPair(largestFile.added, largestFile.removed)}`,
      );
    }
    if (truncatedCount > 0) {
      parts.push(`${truncatedCount} truncated preview${truncatedCount > 1 ? "s" : ""}`);
    }
    return parts;
  }, [largestFile, truncatedCount]);

  return (
    <Flex
      vertical
      gap={compact ? token.marginXS : token.marginSM}
      style={{ width: "100%", minWidth: 0 }}
    >
      <Flex vertical gap={compact ? 4 : 6} style={{ width: "100%", minWidth: 0 }}>
        <Flex
          align="flex-start"
          justify="space-between"
          gap={compact ? token.marginXS : token.marginSM}
          wrap
        >
          <Space size={compact ? 6 : token.marginXS} wrap>
            <DiffOutlined style={{ color: token.colorPrimary }} />
            <Text strong style={compact ? { fontSize: 12 } : undefined}>
              Session diffs
            </Text>
            {!compact ? (
              <Text type="secondary">Review changed files, then open one file at a time.</Text>
            ) : null}
          </Space>
          <Space size={compact ? 2 : 4} wrap>
            {compact ? (
              <InlineMetaText nowrap items={[`${files.length} files`, `${changedTools} tools`]} />
            ) : (
              <>
                <Tag style={compactTagStyle}>{files.length} files</Tag>
                <Tag style={compactTagStyle}>{changedTools} tools</Tag>
              </>
            )}
            <DiffDeltaText value={totalAdded} kind="added" />
            <DiffDeltaText value={totalRemoved} kind="removed" />
          </Space>
        </Flex>

        {compact ? (
          <InlineMetaText block items={compactSummaryItems} />
        ) : (
          <>
            {largestFile ? (
              <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                Largest change: {basename(largestFile.filePath)}{" "}
                {formatDiffDeltaPair(largestFile.added, largestFile.removed)}
              </Text>
            ) : null}

            {truncatedCount > 0 ? (
              <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                {truncatedCount} diff{truncatedCount > 1 ? "s" : ""} truncated in preview.
              </Text>
            ) : null}
          </>
        )}
      </Flex>

      <Flex
        align="center"
        justify="space-between"
        gap={compact ? token.marginXS : token.marginSM}
        wrap
      >
        <Text strong style={compact ? { fontSize: 12 } : undefined}>
          {compact ? "Files" : "Changed files"}
        </Text>
        {files.length > 1 ? (
          <Space size={compact ? 4 : 8} wrap>
            <Button
              size="small"
              type={sortMode === "magnitude" ? "primary" : "default"}
              onClick={() => onSortModeChange("magnitude")}
              data-testid="session-diff-sort-magnitude"
            >
              {compact ? "Largest" : "Largest changes"}
            </Button>
            <Button
              size="small"
              type={sortMode === "path" ? "primary" : "default"}
              onClick={() => onSortModeChange("path")}
              data-testid="session-diff-sort-path"
            >
              Path
            </Button>
          </Space>
        ) : null}
      </Flex>

      <div
        data-testid="session-diff-file-list"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: compact ? 4 : 6,
          width: "100%",
          minWidth: 0,
          maxHeight: compact ? SESSION_DIFF_LIST_MAX_HEIGHT_COMPACT : SESSION_DIFF_LIST_MAX_HEIGHT,
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        {sortedFiles.map((file) => {
          const directoryLabel = dirname(file.filePath);
          const isSelected = selectedFilePath === file.filePath;

          const compactMetaItems = compact
            ? [
                directoryLabel,
                file.toolCount && file.toolCount > 1 ? `${file.toolCount} tool steps` : null,
              ]
            : [];

          return (
            <button
              key={file.filePath}
              type="button"
              aria-pressed={isSelected}
              data-selected={isSelected ? "true" : "false"}
              onClick={() => onSelectFile(file.filePath)}
              data-testid="session-diff-file-row"
              data-file-path={file.filePath}
              style={{
                width: "100%",
                minWidth: 0,
                padding: compact ? `6px 8px` : `${token.paddingSM}px`,
                borderRadius: token.borderRadiusSM,
                border: `1px solid ${isSelected ? token.colorPrimary : token.colorBorderSecondary}`,
                background: isSelected ? token.colorFillSecondary : token.colorFillTertiary,
                boxShadow: isSelected ? `inset 0 0 0 1px ${token.colorPrimary}` : "none",
                cursor: "pointer",
                textAlign: "left",
                transition: "border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease",
              }}
            >
              <Flex
                align="flex-start"
                justify="space-between"
                gap={compact ? token.marginXS : token.marginSM}
                style={{ width: "100%" }}
              >
                <Flex vertical gap={2} style={{ flex: 1, minWidth: 0 }}>
                  <Flex align="center" gap={token.marginXS} style={{ minWidth: 0 }}>
                    <RightOutlined
                      style={{
                        color: isSelected ? token.colorPrimary : token.colorTextSecondary,
                        flex: "0 0 auto",
                      }}
                    />
                    <Text
                      strong
                      ellipsis={{ tooltip: file.filePath }}
                      style={{ display: "block", flex: 1, minWidth: 0 }}
                    >
                      {basename(file.filePath)}
                    </Text>
                    {file.truncated ? (
                      compact ? (
                        <Text type="secondary" style={{ fontSize: 11, flex: "0 0 auto" }}>
                          · trunc.
                        </Text>
                      ) : (
                        <Tag color="warning" style={{ ...compactTagStyle, flex: "0 0 auto" }}>
                          Truncated
                        </Tag>
                      )
                    ) : null}
                  </Flex>

                  {compact ? (
                    <InlineMetaText
                      block
                      items={compactMetaItems}
                      style={{ minWidth: 0, whiteSpace: "normal", wordBreak: "break-word" }}
                    />
                  ) : (
                    <>
                      {directoryLabel ? (
                        <Text
                          type="secondary"
                          ellipsis={{ tooltip: file.filePath }}
                          style={{ display: "block", minWidth: 0, fontSize: token.fontSizeSM }}
                        >
                          {directoryLabel}
                        </Text>
                      ) : null}

                      {file.toolCount && file.toolCount > 1 ? (
                        <Text
                          type="secondary"
                          style={{ fontSize: Math.max(token.fontSizeSM - 1, 11) }}
                        >
                          Touched by {file.toolCount} tool steps
                        </Text>
                      ) : null}
                    </>
                  )}
                </Flex>

                <Flex vertical align="flex-end" gap={compact ? 1 : 0} style={{ flex: "0 0 auto" }}>
                  <DiffDeltaText value={file.added} kind="added" compact={compact} />
                  <DiffDeltaText value={file.removed} kind="removed" compact={compact} />
                </Flex>
              </Flex>
            </button>
          );
        })}
      </div>
    </Flex>
  );
};

const SessionDiffDetailView: React.FC<{
  file: SessionDiffFileSummary;
  currentPosition: number;
  totalFiles: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  compact?: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onBack: () => void;
}> = ({
  file,
  currentPosition,
  totalFiles,
  canGoPrevious,
  canGoNext,
  compact = false,
  onPrevious,
  onNext,
  onBack,
}) => {
  const { token } = theme.useToken();
  const payload = useMemo(() => buildViewerPayload(file), [file]);

  return (
    <Flex
      vertical
      gap={compact ? token.marginXS : token.marginSM}
      style={{ width: "100%", minWidth: 0 }}
      data-testid="session-diff-detail-view"
    >
      <Flex
        align="center"
        justify="space-between"
        gap={compact ? token.marginXS : token.marginSM}
        wrap
      >
        <Space size={compact ? 4 : 8} wrap>
          <Button
            type="text"
            size="small"
            icon={<ArrowLeftOutlined />}
            onClick={onBack}
            data-testid="session-diff-back"
            style={{ paddingInline: 0 }}
          >
            Back to files
          </Button>
          <Text
            type="secondary"
            data-testid="session-diff-position"
            style={compact ? { fontSize: 11 } : undefined}
          >
            File {currentPosition} of {totalFiles}
          </Text>
        </Space>

        {totalFiles > 1 ? (
          <Space size={compact ? 4 : 8} wrap>
            <Button
              size="small"
              icon={<LeftOutlined />}
              onClick={onPrevious}
              disabled={!canGoPrevious}
              data-testid="session-diff-prev"
            >
              Previous
            </Button>
            <Button
              size="small"
              icon={<RightOutlined />}
              onClick={onNext}
              disabled={!canGoNext}
              data-testid="session-diff-next"
            >
              Next
            </Button>
          </Space>
        ) : null}
      </Flex>

      <Flex vertical gap={6} style={{ width: "100%", minWidth: 0 }}>
        <Flex
          align="flex-start"
          justify="space-between"
          gap={compact ? token.marginXS : token.marginSM}
          wrap
        >
          <Flex vertical gap={2} style={{ flex: 1, minWidth: 0 }}>
            <Text
              strong
              ellipsis={{ tooltip: file.filePath }}
              style={{ display: "block", minWidth: 0 }}
            >
              {basename(file.filePath)}
            </Text>
            <Text
              type="secondary"
              ellipsis={{ tooltip: file.filePath }}
              style={{ display: "block", minWidth: 0, fontSize: compact ? 11 : token.fontSizeSM }}
            >
              {file.filePath}
            </Text>
            {file.workspace ? (
              <Text
                type="secondary"
                ellipsis={{ tooltip: file.workspace }}
                style={{ display: "block", minWidth: 0, fontSize: compact ? 11 : token.fontSizeSM }}
              >
                {file.workspace}
              </Text>
            ) : null}
          </Flex>

          <Space size={compact ? 2 : 4} wrap>
            {file.truncated ? (
              <Tag
                color="warning"
                style={
                  compact
                    ? { marginInlineEnd: 0, fontSize: 10, lineHeight: "16px", paddingInline: 6 }
                    : { marginInlineEnd: 0 }
                }
              >
                {compact ? "Trunc." : "Truncated"}
              </Tag>
            ) : null}
            {file.toolCount && file.toolCount > 1 ? (
              <Tag
                style={
                  compact
                    ? { marginInlineEnd: 0, fontSize: 10, lineHeight: "16px", paddingInline: 6 }
                    : { marginInlineEnd: 0 }
                }
              >
                {file.toolCount} tools
              </Tag>
            ) : null}
            <DiffDeltaText value={file.added} kind="added" compact={compact} />
            <DiffDeltaText value={file.removed} kind="removed" compact={compact} />
          </Space>
        </Flex>

        {!compact ? (
          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            Review this file in side-by-side or unified mode.
          </Text>
        ) : null}
      </Flex>

      <FileChangeViewer
        payload={payload}
        defaultViewMode="sideBySide"
        showHeader={false}
        showViewToggle
        compact={compact}
        maxHeight={compact ? "calc(100vh - 240px)" : "calc(100vh - 280px)"}
      />
    </Flex>
  );
};

export const ActiveToolMessageCard: React.FC<ActiveToolMessageCardProps> = ({
  sessionDiffSummary,
  sessionId,
  compact = false,
}) => {
  const { token } = theme.useToken();
  const hasDiff = Boolean(sessionDiffSummary && sessionDiffSummary.files.length > 0);

  const [shouldRender, setShouldRender] = useState(hasDiff);
  const [isVisible, setIsVisible] = useState(hasDiff);
  const [sortMode, setSortMode] = useState<SessionDiffSortMode>("magnitude");
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);

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

  useEffect(() => {
    setSortMode("magnitude");
    setSelectedFilePath(null);
  }, [sessionId]);

  const files = useMemo(() => sessionDiffSummary?.files ?? [], [sessionDiffSummary]);
  const sortedFiles = useMemo(() => sortFiles(files, sortMode), [files, sortMode]);

  const selectedIndex = useMemo(
    () => sortedFiles.findIndex((file) => file.filePath === selectedFilePath),
    [sortedFiles, selectedFilePath],
  );

  const selectedFile = selectedIndex >= 0 ? sortedFiles[selectedIndex] : null;

  useEffect(() => {
    if (!selectedFilePath) {
      return;
    }
    if (!files.some((file) => file.filePath === selectedFilePath)) {
      setSelectedFilePath(null);
    }
  }, [files, selectedFilePath]);

  if (!shouldRender || !sessionDiffSummary) return null;

  return (
    <div
      className={`active-tool-card-wrapper ${isVisible ? "visible" : ""}`}
      aria-hidden={!isVisible}
      data-testid="session-diff-card"
      style={{ width: "100%", minWidth: 0 }}
    >
      <div
        style={
          compact
            ? { width: "100%", minWidth: 0, padding: `2px 0 0` }
            : {
                width: "100%",
                minWidth: 0,
              }
        }
      >
        {compact ? (
          <SessionDiffListView
            files={files}
            changedTools={sessionDiffSummary.changedTools}
            totalAdded={sessionDiffSummary.totalAdded}
            totalRemoved={sessionDiffSummary.totalRemoved}
            sortMode={sortMode}
            selectedFilePath={selectedFilePath}
            compact={compact}
            onSortModeChange={setSortMode}
            onSelectFile={setSelectedFilePath}
          />
        ) : (
          <Card
            size="small"
            style={{
              width: "100%",
              minWidth: 0,
              overflow: "hidden",
              borderRadius: token.borderRadiusLG,
              border: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorBgContainer,
              boxShadow: token.boxShadowSecondary,
            }}
            styles={{ body: { padding: `${token.paddingSM}px` } }}
          >
            <SessionDiffListView
              files={files}
              changedTools={sessionDiffSummary.changedTools}
              totalAdded={sessionDiffSummary.totalAdded}
              totalRemoved={sessionDiffSummary.totalRemoved}
              sortMode={sortMode}
              selectedFilePath={selectedFilePath}
              compact={compact}
              onSortModeChange={setSortMode}
              onSelectFile={setSelectedFilePath}
            />
          </Card>
        )}
      </div>

      <Drawer
        title="Diff details"
        placement="right"
        open={Boolean(selectedFile)}
        onClose={() => setSelectedFilePath(null)}
        width="min(1280px, calc(100vw - 24px))"
        styles={{
          body: { padding: compact ? token.paddingXS : token.paddingLG, minWidth: 0 },
        }}
        destroyOnClose
      >
        {selectedFile ? (
          <SessionDiffDetailView
            file={selectedFile}
            currentPosition={selectedIndex + 1}
            totalFiles={sortedFiles.length}
            canGoPrevious={selectedIndex > 0}
            canGoNext={selectedIndex >= 0 && selectedIndex < sortedFiles.length - 1}
            compact={compact}
            onPrevious={() => {
              if (selectedIndex > 0) {
                setSelectedFilePath(sortedFiles[selectedIndex - 1].filePath);
              }
            }}
            onNext={() => {
              if (selectedIndex >= 0 && selectedIndex < sortedFiles.length - 1) {
                setSelectedFilePath(sortedFiles[selectedIndex + 1].filePath);
              }
            }}
            onBack={() => setSelectedFilePath(null)}
          />
        ) : null}
      </Drawer>
    </div>
  );
};

export default ActiveToolMessageCard;
