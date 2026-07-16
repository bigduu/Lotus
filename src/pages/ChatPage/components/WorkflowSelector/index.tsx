import React from "react";
import { Spin, theme } from "antd";
import { FolderOutlined, GlobalOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useWorkflowSelectorState } from "./useWorkflowSelectorState";

const { useToken } = theme;

interface WorkflowSelectorProps {
  visible: boolean;
  onSelect: (workflow: { name: string; content: string }) => void;
  onCancel: () => void;
  searchText: string;
  onAutoComplete?: (workflowName: string) => void;
}

const WorkflowSelector: React.FC<WorkflowSelectorProps> = ({
  visible,
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
    filteredWorkflows,
    selectedIndex,
    setSelectedIndex,
    isLoading,
    handleWorkflowSelect,
  } = useWorkflowSelectorState({
    visible,
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
        <Spin size="small" /> {t("chat.workflowSelector.loading")}
      </div>
    );
  }

  if (filteredWorkflows.length === 0) {
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
        {searchText
          ? t("chat.workflowSelector.emptyWithSearch", { search: searchText })
          : t("chat.workflowSelector.empty")}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      // Keyboard interaction is implemented at the container level (document
      // keydown in useWorkflowSelectorState: arrows / Ctrl+P/N / Enter /
      // Space / Tab / Esc). Rows intentionally do NOT get tabIndex — that
      // would add a tab stop per row and fight the container navigation.
      role="listbox"
      aria-label={t("chat.workflowSelector.listLabel")}
      style={{
        position: "absolute",
        bottom: "100%",
        left: 0,
        right: 0,
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusSM,
        boxShadow: token.boxShadowSecondary,
        maxHeight: 300,
        overflowY: "auto",
        zIndex: 1000,
        marginBottom: token.marginXS,
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
        {t("chat.workflowSelector.navigationHint")}
      </div>
      {filteredWorkflows.map((workflow, index) => (
        <div
          key={workflow.name}
          ref={index === selectedIndex ? selectedItemRef : null}
          role="option"
          aria-selected={index === selectedIndex}
          style={{
            padding: `${token.paddingSM}px ${token.paddingMD}px`,
            cursor: "pointer",
            borderBottom:
              index < filteredWorkflows.length - 1
                ? `1px solid ${token.colorBorderSecondary}`
                : "none",
            backgroundColor: index === selectedIndex ? token.colorPrimaryBg : "transparent",
            transition: "background-color 0.2s",
          }}
          onClick={() => handleWorkflowSelect(workflow.name)}
          onMouseEnter={() => setSelectedIndex(index)}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div
              style={{
                fontWeight: 600,
                color: token.colorPrimary,
                fontFamily: "monospace",
                fontSize: token.fontSizeSM,
              }}
            >
              /{workflow.name}
            </div>
            <div
              style={{
                fontSize: token.fontSizeSM,
                color: token.colorTextTertiary,
                background: token.colorFillQuaternary,
                padding: `2px ${token.paddingXXS}px`,
                borderRadius: token.borderRadiusXS,
              }}
            >
              {workflow.source === "workspace" ? (
                <>
                  <FolderOutlined /> {t("chat.workflowSelector.source.workspace")}
                </>
              ) : (
                <>
                  <GlobalOutlined /> {t("chat.workflowSelector.source.global")}
                </>
              )}
            </div>
          </div>
          <div
            style={{
              color: token.colorTextSecondary,
              fontSize: token.fontSizeSM,
              marginTop: token.marginXXS,
              lineHeight: 1.4,
            }}
          >
            {workflow.filename} • {(workflow.size / 1024).toFixed(1)} KB
          </div>
        </div>
      ))}
    </div>
  );
};

export default WorkflowSelector;
