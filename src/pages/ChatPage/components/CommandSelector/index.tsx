import React from "react";
import { Alert, Spin, Tag, theme } from "antd";
import { FolderOutlined, ThunderboltOutlined, ApiOutlined, FlagOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useCommandSelectorState } from "./useCommandSelectorState";
import type { CommandItem } from "@shared/types/command";
import { parseMcpToolAlias } from "../../utils/mcpAlias";
import { isCommandSelectable, workflowCommandItemKey } from "../../../../features/workflows";
import "./index.css";

const { useToken } = theme;

interface CommandSelectorProps {
  visible: boolean;
  sessionId?: string | null;
  onSelect: (command: CommandItem) => void;
  onCancel: () => void;
  searchText: string;
  onAutoComplete?: (command: CommandItem) => void;
}

const TYPE_CONFIG = {
  workflow: {
    color: "blue" as const,
    icon: <FolderOutlined />,
    labelKey: "chat.commandSelector.types.workflow",
  },
  skill: {
    color: "green" as const,
    icon: <ThunderboltOutlined />,
    labelKey: "chat.commandSelector.types.skill",
  },
  mcp: {
    color: "purple" as const,
    icon: <ApiOutlined />,
    labelKey: "chat.commandSelector.types.mcp",
  },
  goal: {
    color: "gold" as const,
    icon: <FlagOutlined />,
    labelKey: "chat.commandSelector.types.goal",
  },
};

const CommandSelector: React.FC<CommandSelectorProps> = ({
  visible,
  sessionId,
  onSelect,
  onCancel,
  searchText,
  onAutoComplete,
}) => {
  const { token } = useToken();
  const { t } = useTranslation();
  const {
    containerRef,
    selectedItemRef,
    filteredCommands,
    selectedIndex,
    setSelectedIndex,
    isLoading,
    loadError,
    catalogDiagnostics,
    handleCommandSelect,
  } = useCommandSelectorState({
    visible,
    sessionId,
    searchText,
    onSelect,
    onCancel,
    onAutoComplete,
  });

  if (!visible) {
    return null;
  }

  if (isLoading) {
    return (
      <div
        style={{
          position: "absolute",
          bottom: "100%",
          left: 0,
          right: 0,
          background: token.colorBgContainer,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: token.borderRadiusSM,
          boxShadow: token.boxShadowSecondary,
          padding: `${token.paddingSM}px ${token.paddingMD}px`,
          zIndex: 1000,
          marginBottom: token.marginXS,
          textAlign: "center",
        }}
      >
        <Spin size="small" /> {t("chat.commandSelector.loading")}
      </div>
    );
  }

  if (filteredCommands.length === 0) {
    return (
      <div
        style={{
          position: "absolute",
          bottom: "100%",
          left: 0,
          right: 0,
          background: token.colorBgContainer,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: token.borderRadiusSM,
          boxShadow: token.boxShadowSecondary,
          padding: `${token.paddingSM}px ${token.paddingMD}px`,
          zIndex: 1000,
          marginBottom: token.marginXS,
          textAlign: "center",
          color: token.colorTextSecondary,
        }}
      >
        {loadError && (
          <Alert
            type="warning"
            showIcon
            message={t("chat.commandSelector.degraded", { detail: loadError })}
          />
        )}
        {catalogDiagnostics.length > 0 && (
          <Alert
            type="warning"
            showIcon
            message={t("settings.workflowsTab.partialInvalid", {
              count: catalogDiagnostics.length,
            })}
          />
        )}
        <div
          style={{ paddingTop: loadError || catalogDiagnostics.length > 0 ? token.paddingSM : 0 }}
        >
          {searchText
            ? t("chat.commandSelector.emptyWithSearch", { search: searchText })
            : t("chat.commandSelector.empty")}
        </div>
      </div>
    );
  }

  const renderCommandItem = (command: CommandItem, index: number) => {
    const typeConfig = TYPE_CONFIG[command.type];
    const isSelected = index === selectedIndex;
    const isSelectable = isCommandSelectable(command);
    const workflow = command.metadata.workflowCatalog ? command.metadata : null;

    const mcpParts = command.type === "mcp" ? parseMcpToolAlias(command.name) : null;
    const mcpToolName =
      command.type === "mcp"
        ? command.metadata?.originalName ||
          mcpParts?.toolName ||
          command.displayName ||
          command.name
        : null;
    const mcpServerLabel =
      command.type === "mcp"
        ? command.metadata?.serverName || command.metadata?.serverId || mcpParts?.serverId || null
        : null;

    return (
      <div
        key={workflowCommandItemKey(command)}
        ref={isSelected ? selectedItemRef : null}
        className={`command-selector-item ${isSelected ? "selected" : ""} ${
          isSelectable ? "" : "disabled"
        }`}
        role="option"
        aria-selected={isSelected}
        aria-disabled={!isSelectable}
        onClick={() => void handleCommandSelect(command)}
        onMouseEnter={() => setSelectedIndex(index)}
      >
        <div className="command-selector-item-header">
          <div
            className="command-selector-item-name"
            style={{
              color: token.colorPrimary,
            }}
          >
            /{command.type === "mcp" && mcpToolName ? mcpToolName : command.name}
          </div>
          <div style={{ display: "flex", gap: token.marginXS }}>
            {command.type === "mcp" && mcpServerLabel && (
              <Tag color="processing">{mcpServerLabel}</Tag>
            )}
            {workflow ? (
              <>
                <Tag color={workflow.workflowKind === "instruction" ? "green" : "blue"}>
                  {t(`settings.workflowsTab.kind.${workflow.workflowKind}`)}
                </Tag>
                <Tag>{t(`settings.workflowsTab.source.${workflow.workflowSource}`)}</Tag>
                <Tag color={workflow.workflowStatus === "valid" ? "success" : "warning"}>
                  {t(`settings.workflowsTab.status.${workflow.workflowStatus}`)}
                </Tag>
              </>
            ) : (
              <Tag color={typeConfig.color}>
                {typeConfig.icon} {t(typeConfig.labelKey)}
              </Tag>
            )}
          </div>
        </div>

        {workflow && (
          <div className="command-selector-item-tags">
            <Tag color="geekblue">
              {t(`settings.workflowsTab.invocation.${workflow.workflowInvocationPolicy}`)}
            </Tag>
            {workflow.workflowLegacy && (
              <Tag color="orange">{t("settings.workflowsTab.legacy")}</Tag>
            )}
            {workflow.workflowLastKnownGood && (
              <Tag color="warning">{t("settings.workflowsTab.lastKnownGood")}</Tag>
            )}
            {(workflow.workflowShadowedCandidates?.length ?? 0) > 0 && (
              <>
                {workflow.workflowWinner !== false && (
                  <Tag color="success">{t("settings.workflowsTab.winner")}</Tag>
                )}
                <Tag color="warning">
                  {t("settings.workflowsTab.shadowedCount", {
                    count: workflow.workflowShadowedCandidates?.length ?? 0,
                  })}
                </Tag>
              </>
            )}
            {!isSelectable && <Tag>{t("chat.commandSelector.metadataOnly")}</Tag>}
          </div>
        )}

        {workflow?.workflowArgumentHint && (
          <div
            className="command-selector-item-category"
            style={{ color: token.colorTextTertiary }}
          >
            {t("settings.workflowsTab.arguments")}: {workflow.workflowArgumentHint}
          </div>
        )}

        {workflow && (workflow.workflowVersion || workflow.workflowRevision !== undefined) && (
          <div
            className="command-selector-item-category"
            style={{ color: token.colorTextTertiary }}
          >
            {[
              workflow.workflowVersion
                ? t("settings.workflowsTab.version", { version: workflow.workflowVersion })
                : null,
              workflow.workflowRevision !== undefined
                ? t("settings.workflowsTab.revision", { revision: workflow.workflowRevision })
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        )}

        {workflow?.workflowLastError && (
          <div className="command-selector-item-category" style={{ color: token.colorError }}>
            {workflow.workflowLastError}
          </div>
        )}

        <div
          className="command-selector-item-description"
          style={{
            color: token.colorTextSecondary,
          }}
        >
          {command.description}
        </div>

        {command.type === "mcp" && mcpServerLabel && (
          <div
            className="command-selector-item-category"
            style={{
              color: token.colorTextTertiary,
            }}
          >
            {t("common.server")} {mcpServerLabel}
          </div>
        )}

        {command.category && !workflow && (
          <div
            className="command-selector-item-category"
            style={{
              color: token.colorTextTertiary,
            }}
          >
            {t("common.category")} {command.category}
          </div>
        )}

        {command.tags && command.tags.length > 0 && !workflow && (
          <div className="command-selector-item-tags">
            {command.tags.slice(0, 3).map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      className="command-selector-container"
      // Keyboard interaction is implemented at the container level (document
      // keydown in useCommandSelectorState: arrows / Ctrl+P/N / Enter /
      // Space / Tab / Esc). Rows intentionally do NOT get tabIndex — that
      // would add a tab stop per row and fight the container navigation.
      role="listbox"
      aria-label={t("chat.commandSelector.listLabel")}
      style={{
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusSM,
        boxShadow: token.boxShadowSecondary,
      }}
    >
      <div
        style={{
          padding: `${token.paddingXXS}px ${token.paddingSM}px`,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorFillQuaternary,
          fontSize: token.fontSizeSM,
          color: token.colorTextTertiary,
        }}
      >
        {t("chat.commandSelector.navigationHint")}
      </div>
      {loadError && (
        <Alert
          type="warning"
          showIcon
          banner
          message={t("chat.commandSelector.degraded", { detail: loadError })}
        />
      )}
      {catalogDiagnostics.length > 0 && (
        <Alert
          type="warning"
          showIcon
          banner
          message={t("settings.workflowsTab.partialInvalid", {
            count: catalogDiagnostics.length,
          })}
        />
      )}
      {filteredCommands.map((command, index) => renderCommandItem(command, index))}
    </div>
  );
};

export default CommandSelector;
