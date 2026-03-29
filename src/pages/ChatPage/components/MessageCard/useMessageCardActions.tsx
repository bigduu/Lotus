import type { MouseEvent, RefObject } from "react";
import { useCallback, useMemo, useState } from "react";
import {
  BookOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  HistoryOutlined,
  RedoOutlined,
} from "@ant-design/icons";
import type { MenuProps } from "antd";
import { App as AntApp } from "antd";
import { useTranslation } from "react-i18next";
import { MessageExportService } from "../../services/MessageExportService";
import { copyText } from "@shared/utils/clipboard";

interface UseMessageCardActionsProps {
  messageText: string;
  messageId?: string;
  currentSessionId?: string | null;
  onDelete?: (messageId: string) => void;
  onRestoreChat?: () => void | Promise<void>;
  onRestoreFilesAndChat?: () => void | Promise<void>;
  cardRef: RefObject<HTMLDivElement>;
}

export const useMessageCardActions = ({
  messageText,
  messageId,
  currentSessionId,
  onDelete,
  onRestoreChat,
  onRestoreFilesAndChat,
  cardRef,
}: UseMessageCardActionsProps) => {
  const { message: appMessage } = AntApp.useApp();
  const { t } = useTranslation();
  const [selectedText, setSelectedText] = useState<string>("");

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await copyText(text);
    } catch (e) {
      console.error("Failed to copy text:", e);
    }
  }, []);

  const createReference = useCallback((text: string) => {
    return `> ${text.replace(/\n/g, "\n> ")}`;
  }, []);

  const referenceMessage = useCallback(() => {
    if (!currentSessionId) return;
    const referenceText = selectedText
      ? createReference(selectedText)
      : createReference(messageText);
    const event = new CustomEvent("reference-text", {
      detail: { text: referenceText, sessionId: currentSessionId },
    });
    window.dispatchEvent(event);
  }, [createReference, currentSessionId, messageText, selectedText]);

  const exportContent = useCallback(
    async (format: "markdown" | "pdf") => {
      const text = selectedText || messageText;
      if (!text) {
        appMessage.warning(t("chat.messageActions.nothingToExport"));
        return;
      }

      const result = await MessageExportService.exportMessageText({
        format,
        content: text,
        sessionId: currentSessionId ?? null,
        messageId: messageId ?? null,
      });

      if (result.success) {
        appMessage.success(t("chat.messageActions.savedFile", { filename: result.filename }));
      } else {
        // "User cancelled" is not actionable; keep it quiet.
        if (result.error?.toLowerCase().includes("cancel")) {
          return;
        }
        appMessage.error(result.error || t("chat.messageActions.exportFailed"));
      }
    },
    [appMessage, currentSessionId, messageId, messageText, selectedText, t],
  );

  const handleMouseUp = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const selection = window.getSelection();
      const text = selection ? selection.toString() : "";
      if (text && cardRef.current && selection && cardRef.current.contains(selection.anchorNode)) {
        setSelectedText(text);
      } else {
        setSelectedText("");
      }
    },
    [cardRef],
  );

  const contextMenuItems = useMemo(() => {
    const baseItems: NonNullable<MenuProps["items"]> = [
      ...(onRestoreChat && onRestoreFilesAndChat && currentSessionId && messageId
        ? [
            {
              key: "restore-chat",
              label: t("chat.messageActions.restoreChat"),
              icon: <HistoryOutlined />,
              onClick: () => {
                void onRestoreChat();
              },
            },
            {
              key: "restore-chat-files",
              label: t("chat.messageActions.restoreFilesAndChat"),
              icon: <RedoOutlined />,
              onClick: () => {
                void onRestoreFilesAndChat();
              },
            },
            { type: "divider" as const },
          ]
        : []),
      {
        key: "copy",
        label: t("chat.messageActions.copy"),
        icon: <CopyOutlined />,
        onClick: () => {
          if (selectedText) {
            copyToClipboard(selectedText);
          } else {
            copyToClipboard(messageText);
          }
        },
      },
      {
        key: "reference",
        label: t("chat.actions.referenceMessage"),
        icon: <BookOutlined />,
        onClick: referenceMessage,
      },
      { type: "divider" },
      {
        key: "export-md",
        label: t("chat.messageActions.exportMarkdown"),
        icon: <DownloadOutlined />,
        onClick: () => exportContent("markdown"),
      },
      {
        key: "export-pdf",
        label: t("chat.messageActions.exportPdf"),
        icon: <DownloadOutlined />,
        onClick: () => exportContent("pdf"),
      },
    ];

    if (onDelete && messageId) {
      baseItems.push({
        key: "delete",
        label: t("chat.messageActions.deleteMessage"),
        icon: <DeleteOutlined />,
        onClick: () => onDelete(messageId),
        danger: true,
      });
    }

    return baseItems;
  }, [
    copyToClipboard,
    exportContent,
    messageId,
    messageText,
    onDelete,
    onRestoreChat,
    onRestoreFilesAndChat,
    referenceMessage,
    selectedText,
    currentSessionId,
    t,
  ]);

  return {
    contextMenuItems,
    handleMouseUp,
    copyToClipboard,
    referenceMessage,
  };
};
