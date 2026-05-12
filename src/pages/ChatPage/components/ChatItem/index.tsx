import React, { memo, useState, useCallback } from "react";
import { List, Button, Input, Dropdown, theme } from "antd";
import type { MenuProps } from "antd";
import {
  DeleteOutlined,
  PushpinFilled,
  PushpinOutlined,
  EditOutlined,
  CheckOutlined,
  CloseOutlined,
  BulbOutlined,
  LoadingOutlined,
  MoreOutlined,
  CloudSyncOutlined,
  CompassOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import type { SidebarChatListItem } from "../../types/sidebarChat";

interface ChatItemProps {
  chat: SidebarChatListItem;
  isSelected: boolean;
  compact?: boolean;
  onSelect: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
  onPin: (sessionId: string) => void;
  onUnpin: (sessionId: string) => void;
  onEdit?: (sessionId: string, newTitle: string) => void;
  onGenerateTitle?: (sessionId: string) => void;
  onRunProjectDream?: (sessionId: string) => void;
  isGeneratingTitle?: boolean;
  isRunningProjectDream?: boolean;
  titleGenerationError?: string;
}

const ChatItemComponent: React.FC<ChatItemProps> = ({
  chat,
  isSelected,
  compact = false,
  onSelect,
  onDelete,
  onPin,
  onUnpin,
  onEdit,
  onGenerateTitle,
  onRunProjectDream,
  isGeneratingTitle,
  isRunningProjectDream,
  titleGenerationError,
}) => {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(chat.title);
  const [isHovered, setIsHovered] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const { token } = theme.useToken();

  const handleSave = useCallback(
    (e: React.SyntheticEvent) => {
      e.stopPropagation();
      if (onEdit && editValue.trim()) {
        onEdit(chat.id, editValue.trim());
      }
      setIsEditing(false);
    },
    [chat.id, editValue, onEdit],
  );

  const handleCancel = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setEditValue(chat.title);
      setIsEditing(false);
    },
    [chat.title],
  );

  // Build dropdown menu items
  const menuItems: MenuProps["items"] = [
    {
      key: "pin",
      icon: chat.pinned ? (
        <PushpinFilled style={{ color: token.colorWarning }} />
      ) : (
        <PushpinOutlined />
      ),
      label: chat.pinned ? t("chat.actions.unpin") : t("chat.actions.pin"),
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation();
        chat.pinned ? onUnpin(chat.id) : onPin(chat.id);
      },
    },
    {
      key: "edit",
      icon: <EditOutlined />,
      label: t("chat.chatItem.edit"),
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation();
        setIsEditing(true);
      },
    },
    ...(onGenerateTitle
      ? [
          {
            key: "generate-title",
            icon: isGeneratingTitle ? (
              <LoadingOutlined />
            ) : (
              <BulbOutlined
                style={titleGenerationError ? { color: token.colorError } : undefined}
              />
            ),
            label: titleGenerationError || t("chat.actions.generateTitle"),
            disabled: isGeneratingTitle,
            onClick: ({ domEvent }: { domEvent: React.MouseEvent | React.KeyboardEvent }) => {
              domEvent.stopPropagation();
              onGenerateTitle(chat.id);
            },
          },
        ]
      : []),
    ...(onRunProjectDream
      ? [
          {
            key: "run-project-dream",
            icon: isRunningProjectDream ? <LoadingOutlined /> : <CloudSyncOutlined />,
            label: t("chat.actions.runProjectDream"),
            disabled: isRunningProjectDream,
            onClick: ({ domEvent }: { domEvent: React.MouseEvent | React.KeyboardEvent }) => {
              domEvent.stopPropagation();
              onRunProjectDream(chat.id);
            },
          },
        ]
      : []),
    { type: "divider" as const },
    {
      key: "delete",
      icon: <DeleteOutlined />,
      label: t("common.delete"),
      danger: true,
      onClick: ({ domEvent }: { domEvent: React.MouseEvent | React.KeyboardEvent }) => {
        domEvent.stopPropagation();
        onDelete(chat.id);
      },
    },
  ];

  // Dynamic style calculation
  const itemStyle: React.CSSProperties = {
    padding: compact ? "4px 8px" : "5px 8px",
    borderRadius: token.borderRadiusSM,
    marginBottom: 0,
    cursor: "pointer",
    transition: "background-color 0.2s ease, box-shadow 0.2s ease",
    backgroundColor: isSelected
      ? "var(--lotus-primary-soft)"
      : isHovered || dropdownOpen
        ? "var(--lotus-item-hover-bg)"
        : "transparent",
    border: "1px solid transparent",
    borderColor: "transparent",
    position: "relative",
    overflow: "visible",
    boxShadow: isSelected ? `inset 2px 0 0 ${token.colorPrimary}` : "none",
    minHeight: compact ? 28 : 30,
  };

  const titleStyle: React.CSSProperties = {
    flex: 1,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    fontSize: compact ? 12 : 12.5,
    lineHeight: 1.3,
    fontWeight: isSelected ? 600 : 500,
    color: isSelected ? "var(--lotus-primary)" : token.colorText,
  };

  const editInputStyle: React.CSSProperties = {
    flex: 1,
    fontSize: token.fontSizeSM,
    marginRight: token.marginSM,
  };

  // Show save/cancel when editing, or "⋯" dropdown when hovered
  const actions = isEditing
    ? [
        <Button
          key="save"
          type="text"
          size="small"
          icon={<CheckOutlined style={{ color: token.colorSuccess }} />}
          onClick={handleSave}
          aria-label={t("common.save")}
        />,
        <Button
          key="cancel"
          type="text"
          size="small"
          icon={<CloseOutlined style={{ color: token.colorError }} />}
          onClick={handleCancel}
          aria-label={t("common.cancel")}
        />,
      ]
    : isHovered || dropdownOpen
      ? [
          <Dropdown
            key="more"
            menu={{ items: menuItems, className: "lotus-sidebar-actions-menu" }}
            trigger={["click"]}
            placement="bottomRight"
            overlayClassName="lotus-sidebar-actions-dropdown"
            open={dropdownOpen}
            onOpenChange={(open) => setDropdownOpen(open)}
          >
            <Button
              type="text"
              size="small"
              icon={<MoreOutlined />}
              aria-label={t("common.moreActions", "More actions")}
              onClick={(e) => e.stopPropagation()}
              style={{
                color: token.colorTextSecondary,
                borderRadius: token.borderRadiusSM,
                background: "transparent",
                width: compact ? 16 : 18,
                height: compact ? 16 : 18,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            />
          </Dropdown>,
        ]
      : [];

  return (
    <List.Item
      style={itemStyle}
      tabIndex={0}
      onClick={() => !isEditing && onSelect(chat.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !isEditing) {
          e.preventDefault();
          onSelect(chat.id);
        } else if (e.key === "Delete" || e.key === "Backspace") {
          if (!isEditing && e.metaKey) {
            e.preventDefault();
            onDelete(chat.id);
          }
        }
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        if (!dropdownOpen) setIsHovered(false);
      }}
      onFocus={() => setIsHovered(true)}
      onBlur={() => {
        if (!dropdownOpen) setIsHovered(false);
      }}
      actions={actions}
      data-testid="chat-item"
      role="option"
      aria-selected={isSelected}
      aria-label={chat.title || t("chat.sidebar.untitledChat")}
    >
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center" }}>
        {isEditing ? (
          <Input
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onPressEnter={(e) => {
              e.preventDefault();
              handleSave(e);
            }}
            autoFocus
            style={editInputStyle}
            variant="borderless"
            size="small"
          />
        ) : (
          <div
            style={{
              ...titleStyle,
              display: "flex",
              alignItems: "center",
              gap: compact ? 4 : token.marginXS,
              minWidth: 0,
            }}
          >
            {chat.pinned && (
              <PushpinFilled
                style={{
                  color: token.colorWarning,
                  fontSize: 11,
                  flexShrink: 0,
                }}
              />
            )}
            <span
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {chat.title}
            </span>
            {chat.kind === "child" ? (
              <span
                style={{
                  color: token.colorInfo,
                  fontSize: compact ? 10 : 11,
                  lineHeight: 1.2,
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                }}
              >
                {t("chat.chatItem.childTag")}
              </span>
            ) : null}
            {chat.planMode ? (
              <span
                style={{
                  color: "#722ed1",
                  fontSize: compact ? 10 : 11,
                  lineHeight: 1.2,
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                }}
              >
                <CompassOutlined />
                {t("chat.planMode.badge", "Plan")}
              </span>
            ) : null}
          </div>
        )}
      </div>
    </List.Item>
  );
};

// Custom comparison function to ensure re-render when title changes
const arePropsEqual = (prevProps: ChatItemProps, nextProps: ChatItemProps): boolean => {
  return (
    prevProps.chat.id === nextProps.chat.id &&
    prevProps.chat.title === nextProps.chat.title &&
    prevProps.chat.pinned === nextProps.chat.pinned &&
    prevProps.chat.planMode === nextProps.chat.planMode &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.compact === nextProps.compact &&
    prevProps.isGeneratingTitle === nextProps.isGeneratingTitle &&
    prevProps.isRunningProjectDream === nextProps.isRunningProjectDream &&
    prevProps.titleGenerationError === nextProps.titleGenerationError
  );
};

export const ChatItem = memo(ChatItemComponent, arePropsEqual);
ChatItem.displayName = "ChatItem";

export default ChatItem;
