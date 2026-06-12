import { memo, useEffect, useRef, useState, type ReactElement } from "react";
import { Button, Flex, Modal, Popover, Tag, Typography, theme } from "antd";
import { useTranslation } from "react-i18next";

import { useChildPreviewState } from "../../streaming/useChildPreviewState";

const { Text } = Typography;
const { useToken } = theme;

/**
 * Shared scrollable preview body: renders the child's live output tail and
 * auto-scrolls to the bottom whenever the content updates.
 */
const ChildPreviewContent = memo(function ChildPreviewContent({
  preview,
  maxHeight,
}: {
  preview: string;
  maxHeight: string | number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { token } = useToken();

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [preview]);

  return (
    <div
      ref={scrollRef}
      style={{
        maxHeight,
        overflowY: "auto",
        overflowX: "hidden",
        fontFamily: "monospace",
        fontSize: token.fontSizeSM,
        lineHeight: 1.5,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        color: token.colorTextSecondary,
      }}
    >
      {preview}
    </div>
  );
});

export interface ChildPreviewPopoverProps {
  parentSessionId: string;
  childSessionId: string;
  childTitle?: string;
  status?: string;
  onOpenChild: (childSessionId: string) => void;
  children: ReactElement;
}

/**
 * Three-level progressive child preview:
 *  1. Hover Popover – compact live output tail with an "Expand" action.
 *  2. Expand → maskless Modal with a taller live view + session/close actions.
 *  3. "Open session" → delegates to the parent's onOpenChild callback.
 */
export const ChildPreviewPopover = ({
  parentSessionId,
  childSessionId,
  childTitle,
  status,
  onOpenChild,
  children,
}: ChildPreviewPopoverProps) => {
  const { t } = useTranslation();
  const { token } = useToken();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const livePreviewState = useChildPreviewState(parentSessionId, childSessionId);
  const preview = livePreviewState.outputPreview;

  const statusTagColor =
    status === "running"
      ? "processing"
      : status === "completed"
        ? "success"
        : status === "error" || status === "failed"
          ? "error"
          : status === "cancelled"
            ? "warning"
            : "default";

  const statusLabel =
    status === "running"
      ? t("chat.subAgents.statusRunning")
      : status === "completed"
        ? t("chat.subAgents.statusCompleted")
        : status === "pending"
          ? t("chat.subAgents.statusPending")
          : status === "cancelled"
            ? t("chat.subAgents.statusCancelled")
            : status === "error" || status === "failed"
              ? t("chat.subAgents.statusFailed")
              : (status ?? "");

  const handleExpand = () => {
    setPopoverOpen(false);
    setModalOpen(true);
  };

  const handleOpenSession = () => {
    setModalOpen(false);
    onOpenChild(childSessionId);
  };

  const popoverContent = (
    <div>
      <Flex justify="flex-end" style={{ marginBottom: token.marginXS }}>
        <Button size="small" type="link" onClick={handleExpand}>
          {t("chat.subAgents.previewExpand")}
        </Button>
      </Flex>
      <ChildPreviewContent preview={preview} maxHeight={320} />
    </div>
  );

  return (
    <>
      <Popover
        trigger="hover"
        mouseEnterDelay={0.3}
        open={popoverOpen && !modalOpen}
        onOpenChange={setPopoverOpen}
        content={popoverContent}
        overlayInnerStyle={{ width: 420 }}
      >
        {children}
      </Popover>
      <Modal
        open={modalOpen}
        mask={false}
        width={640}
        onCancel={() => setModalOpen(false)}
        title={
          <Flex align="center" gap={token.marginXS}>
            <Text strong ellipsis style={{ minWidth: 0 }}>
              {childTitle || t("chat.subAgents.fallbackTitle")}
            </Text>
            {status ? (
              <Tag color={statusTagColor} style={{ flex: "0 0 auto" }}>
                {statusLabel}
              </Tag>
            ) : null}
          </Flex>
        }
        footer={
          <Flex justify="flex-end" gap={token.marginSM}>
            <Button onClick={() => setModalOpen(false)}>{t("chat.subAgents.previewClose")}</Button>
            <Button type="primary" onClick={handleOpenSession}>
              {t("chat.subAgents.previewOpenSession")}
            </Button>
          </Flex>
        }
      >
        <ChildPreviewContent preview={preview} maxHeight="60vh" />
      </Modal>
    </>
  );
};
