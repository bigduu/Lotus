import React, { useRef, useMemo, useCallback } from "react";
import { Flex, message, theme } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { useTranslation } from "react-i18next";
import { useIsMobile } from "@shared/hooks/useMediaQuery";
import { ImageFile } from "../../utils/imageUtils";
import ImagePreviewModal from "../ImagePreviewModal";
import {
  getInputHighlightSegments,
  WorkflowCommandInfo,
  FileReferenceInfo,
} from "../../utils/inputHighlight";
import { ProcessedFile } from "../../utils/fileUtils";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import MessageInputDragOverlay from "./MessageInputDragOverlay";
import MessageInputImageStrip from "./MessageInputImageStrip";
import MessageInputField from "./MessageInputField";
import MessageInputControlsLeft from "./MessageInputControlsLeft";
import MessageInputControlsRight from "./MessageInputControlsRight";
import MessageInputFooter from "./MessageInputFooter";
import { useMessageInputAttachments } from "./useMessageInputAttachments";
import { useMessageInputEffects } from "./useMessageInputEffects";
import { useMessageInputHandlers } from "./useMessageInputHandlers";
import type { MessageRetryMode } from "./types";
// ToolService import removed - no longer needed for tool validation

export interface MessageInputInteractionControls {
  /** True when the assistant is actively streaming visible output tokens. */
  isStreaming: boolean;
  /**
   * True when the current request is still active and the composer should behave as busy/locked,
   * even if no tokens are currently streaming yet.
   */
  isInputLocked?: boolean;
  /** Whether the send button should show as a cancel button. Defaults to isInputLocked. */
  canCancel?: boolean;
  hasMessages: boolean;
  allowRetry?: boolean;
  onRetry?: (mode: MessageRetryMode) => void;
  onCancel?: () => void;
  onHistoryNavigate?: (direction: "previous" | "next", currentValue: string) => string | null;
}

interface MessageInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (content: string, images?: ImageFile[]) => void;
  placeholder?: string;
  disabled?: boolean;
  interaction: MessageInputInteractionControls;
  images?: ImageFile[];
  onImagesChange?: (images: ImageFile[]) => void;
  allowImages?: boolean;
  isCommandSelectorVisible?: boolean; // Prevent Enter key handling when the command selector is open
  textAreaRef?: React.RefObject<TextAreaRef>; // Add textAreaRef prop
  statusIndicator?: React.ReactNode;
  validateMessage?: (message: string) => {
    isValid: boolean;
    errorMessage?: string;
  };
  onAttachmentsAdded?: (files: ProcessedFile[]) => void;
  onWorkflowCommandChange?: (info: WorkflowCommandInfo) => void;
  onFileReferenceChange?: (info: FileReferenceInfo) => void;
  onFileReferenceButtonClick?: () => void;
  maxCharCount?: number;
  leftControlsExtra?: React.ReactNode;
  submitButtonLabel?: string;
}

export const MessageInput = React.memo<MessageInputProps>(
  ({
    value,
    onChange,
    onSubmit,
    interaction,
    placeholder,
    disabled = false,
    images: propImages,
    onImagesChange,
    allowImages = true,
    isCommandSelectorVisible = false,
    textAreaRef: externalTextAreaRef, // External ref from parent
    statusIndicator,
    validateMessage,
    onAttachmentsAdded,
    onWorkflowCommandChange,
    onFileReferenceChange,
    onFileReferenceButtonClick,
    maxCharCount,
    leftControlsExtra,
    submitButtonLabel,
  }) => {
    const { t } = useTranslation();
    const {
      isStreaming,
      isInputLocked = isStreaming,
      canCancel,
      hasMessages,
      allowRetry = true,
      onRetry,
      onCancel,
      onHistoryNavigate,
    } = interaction;
    const fileInputRef = useRef<HTMLInputElement>(null);
    const internalTextAreaRef = useRef<TextAreaRef>(null);
    const textAreaRef = externalTextAreaRef || internalTextAreaRef; // Use external ref if provided
    const highlightOverlayRef = useRef<HTMLDivElement>(null);
    const { token } = theme.useToken();
    const isMobile = useIsMobile();
    const isVdiSafeMode =
      typeof document !== "undefined" && document.body.getAttribute("data-vdi-safe") === "true";
    const [messageApi, contextHolder] = message.useMessage();
    const charCount = value.length;
    const hasCharLimit =
      typeof maxCharCount === "number" && Number.isFinite(maxCharCount) && maxCharCount > 0;
    const isOverCharLimit = hasCharLimit ? charCount > maxCharCount : false;
    const isNearCharLimit = hasCharLimit
      ? !isOverCharLimit && charCount >= maxCharCount * 0.9
      : false;

    const {
      images,
      setImages,
      previewModalVisible,
      setPreviewModalVisible,
      previewImageIndex,
      handleImagePreview,
      clearImages,
      isProcessingAttachments,
      isDragOver,
      handleDragOver,
      handleDragLeave,
      handleDrop,
      handlePaste,
      handleFileInputChange,
    } = useMessageInputAttachments({
      allowImages,
      onAttachmentsAdded,
      messageApi,
    });

    // Use debounced value only for triggering workflow/file search to avoid excessive API calls
    // But use real-time value for highlighting to prevent input lag
    const debouncedValue = useDebouncedValue(value, 80);

    const highlightSegments = useMemo(() => getInputHighlightSegments(value), [value]);

    const syncOverlayScroll = useCallback(() => {
      const textArea = textAreaRef.current?.resizableTextArea?.textArea;
      if (!textArea || !highlightOverlayRef.current) return;
      const scrollTop = textArea.scrollTop;
      const scrollLeft = textArea.scrollLeft;
      highlightOverlayRef.current.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`;
    }, [textAreaRef]);

    useMessageInputEffects({
      value,
      debouncedValue,
      onWorkflowCommandChange,
      onFileReferenceChange,
      onImagesChange,
      images,
      propImages,
      setImages,
      syncOverlayScroll,
    });

    // Note: Tool validation logic removed - users no longer input tool commands directly
    // Tools are now called autonomously by LLM based on user intent

    const { handleKeyDown, handleSubmit, handleRetry, compositionProps } = useMessageInputHandlers({
      value,
      images,
      isInputLocked,
      disabled,
      isCommandSelectorVisible,
      onChange,
      onSubmit,
      onRetry,
      onHistoryNavigate,
      validateMessage,
      isOverCharLimit,
      maxCharCount,
      messageApi,
      clearImages,
      textAreaRef,
    });

    const resolvedPlaceholder = placeholder ?? t("chat.input.placeholder");

    return (
      <>
        {/* Ant Design message context holder */}
        {contextHolder}

        {/* Input Container with Drag & Drop */}
        <div
          className={`message-input-container lotus-message-input-shell ${isDragOver ? "is-drag-over" : ""}`}
          role="group"
          aria-label={t("chat.input.messageComposer")}
          style={{
            position: "relative",
            border: `1px solid ${isDragOver ? "var(--lotus-input-border-active)" : "var(--lotus-input-border)"}`,
            borderRadius: 26,
            background: isDragOver ? "var(--lotus-input-bg-active)" : "var(--lotus-input-bg)",
            backdropFilter: isVdiSafeMode ? "none" : "blur(18px)",
            WebkitBackdropFilter: isVdiSafeMode ? "none" : "blur(18px)",
            boxShadow: "var(--lotus-input-shadow)",
            transition: "all 0.26s cubic-bezier(0.16, 1, 0.3, 1)",
            width: "100%",
            padding: isMobile ? `${token.paddingXS}px` : `${token.paddingSM}px`,
            overflow: "hidden",
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <MessageInputImageStrip
            images={images}
            token={token}
            allowImages={allowImages}
            onPreview={handleImagePreview}
            onClear={clearImages}
          />
          <MessageInputDragOverlay visible={isDragOver} token={token} />

          {/* Input with integrated buttons */}
          <Flex
            vertical
            style={{
              gap: token.marginXS,
              minHeight: isMobile ? 0 : 132,
              width: "100%",
            }}
          >
            {/* Text input */}
            <MessageInputField
              value={value}
              placeholder={resolvedPlaceholder}
              disabled={disabled}
              token={token}
              highlightSegments={highlightSegments}
              textAreaRef={textAreaRef}
              highlightOverlayRef={highlightOverlayRef}
              onChange={onChange}
              onKeyDown={handleKeyDown}
              onCompositionStart={compositionProps.onCompositionStart}
              onCompositionEnd={compositionProps.onCompositionEnd}
              onPaste={handlePaste}
              onScrollSync={syncOverlayScroll}
            />

            <Flex
              align="center"
              justify="space-between"
              gap={token.marginSM}
              wrap="wrap"
              style={{
                rowGap: token.marginXS,
              }}
            >
              <Flex
                align="center"
                gap={token.marginXS}
                wrap="wrap"
                style={{
                  minWidth: 0,
                  flex: "1 1 260px",
                }}
              >
                {/* Left side buttons */}
                <MessageInputControlsLeft
                  allowImages={allowImages}
                  disabled={disabled}
                  isInputLocked={isInputLocked}
                  token={token}
                  fileInputRef={fileInputRef}
                  onFileInputChange={handleFileInputChange}
                  onFileReferenceButtonClick={onFileReferenceButtonClick}
                  extraControl={leftControlsExtra}
                />
              </Flex>

              {/* Right side buttons */}
              <MessageInputControlsRight
                allowRetry={allowRetry}
                hasMessages={hasMessages}
                isStreaming={isStreaming}
                isInputLocked={isInputLocked}
                canCancel={canCancel}
                disabled={disabled}
                onRetry={handleRetry}
                onCancel={onCancel}
                onSubmit={handleSubmit}
                value={value}
                images={images}
                isOverCharLimit={isOverCharLimit}
                token={token}
                statusIndicator={statusIndicator}
                submitButtonLabel={submitButtonLabel}
              />
            </Flex>
          </Flex>
        </div>

        <MessageInputFooter
          charCount={charCount}
          maxCharCount={maxCharCount}
          isOverCharLimit={isOverCharLimit}
          isNearCharLimit={isNearCharLimit}
          isProcessingAttachments={isProcessingAttachments}
          token={token}
        />
        {allowImages && (
          <ImagePreviewModal
            visible={previewModalVisible}
            images={images}
            currentIndex={previewImageIndex}
            onClose={() => setPreviewModalVisible(false)}
          />
        )}
      </>
    );
  },
);
