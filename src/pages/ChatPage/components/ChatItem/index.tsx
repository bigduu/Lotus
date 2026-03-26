import React, { memo, useState, useCallback } from "react";
import { List, Button, Input, Tag, Dropdown, theme } from "antd";
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
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { ChatItem as ChatItemType } from "../../types/chat";

interface ChatItemProps {
  chat: ChatItemType;
  isSelected: boolean;
  onSelect: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
  onPin: (sessionId: string) => void;
  onUnpin: (sessionId: string) => void;
  onEdit?: (sessionId: string, newTitle: string) => void;
  onGenerateTitle?: (sessionId: string) => void;
  isGeneratingTitle?: boolean;
  titleGenerationError?: string;
}

const ChatItemComponent: React.FC<ChatItemProps> = ({
  chat,
  isSelected,
  onSelect,
  onDelete,
  onPin,
  onUnpin,
  onEdit,
  onGenerateTitle,
  isGeneratingTitle,
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
    padding: "8px 12px",
    borderRadius: token.borderRadiusSM,
    marginBottom: token.marginXXS,
    cursor: "pointer",
    transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
    backgroundColor: isSelected
      ? "var(--lotus-primary-soft)"
      : isHovered || dropdownOpen
        ? "var(--lotus-item-hover-bg)"
        : "transparent",
    border: "1px solid transparent",
    borderColor: isSelected
      ? "var(--lotus-tool-card-border)"
      : isHovered || dropdownOpen
        ? token.colorBorderSecondary
        : "transparent",
    position: "relative",
    overflow: "visible",
    boxShadow: isSelected ? "var(--lotus-tool-card-shadow)" : "none",
    transform: isHovered && !isSelected ? "translateX(2px)" : "none",
  };

  const titleStyle: React.CSSProperties = {
    flex: 1,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    fontSize: 13,
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
            menu={{ items: menuItems }}
            trigger={["click"]}
            placement="bottomRight"
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
                background: token.colorFillTertiary,
                width: 24,
                height: 24,
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
      <List.Item.Meta
        title={
          isEditing ? (
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
                gap: token.marginXS,
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
                <Tag color="processing" style={{ marginInlineEnd: 0, flex: "0 0 auto" }}>
                  {t("chat.chatItem.childTag")}
                </Tag>
              ) : null}
            </div>
          )
        }
      />
    </List.Item>
  );
};

// Custom comparison function to ensure re-render when title changes
const arePropsEqual = (prevProps: ChatItemProps, nextProps: ChatItemProps): boolean => {
  return (
    prevProps.chat.id === nextProps.chat.id &&
    prevProps.chat.title === nextProps.chat.title &&
    prevProps.chat.pinned === nextProps.chat.pinned &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isGeneratingTitle === nextProps.isGeneratingTitle &&
    prevProps.titleGenerationError === nextProps.titleGenerationError
  );
};

export const ChatItem = memo(ChatItemComponent, arePropsEqual);
ChatItem.displayName = "ChatItem";

export default ChatItem;
