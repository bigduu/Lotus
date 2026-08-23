import { useCallback, useRef } from "react";
import type { TextAreaRef } from "antd/es/input/TextArea";
import i18n from "i18next";
import type { ImageFile } from "../../utils/imageUtils";
import type { MessageRetryMode, MessageSubmitOutcome } from "./types";

interface UseMessageInputHandlersProps {
  value: string;
  images: ImageFile[];
  /** True when the input should be locked (starting, running, streaming, running_tools, running_children, settling). */
  isInputLocked: boolean;
  disabled: boolean;
  isCommandSelectorVisible: boolean;
  onChange: (value: string) => void;
  onSubmit: (
    content: string,
    images?: ImageFile[],
  ) => MessageSubmitOutcome | Promise<MessageSubmitOutcome>;
  onRetry?: (mode: MessageRetryMode) => void;
  onHistoryNavigate?: (direction: "previous" | "next", currentValue: string) => string | null;
  validateMessage?: (message: string) => {
    isValid: boolean;
    errorMessage?: string;
  };
  isOverCharLimit: boolean;
  maxCharCount?: number;
  messageApi: {
    error: (content: string) => void;
  };
  clearImages: (imageIds?: readonly string[]) => void;
  textAreaRef: React.RefObject<TextAreaRef>;
}

export const useMessageInputHandlers = ({
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
}: UseMessageInputHandlersProps) => {
  const handleSubmit = useCallback(() => {
    const trimmedContent = value.trim();
    if ((!trimmedContent && images.length === 0) || isInputLocked || disabled) {
      return;
    }

    if (isOverCharLimit) {
      const maxLengthLabel =
        typeof maxCharCount === "number" ? maxCharCount.toLocaleString() : "configured";
      messageApi.error(i18n.t("chat.input.charLimitExceeded", { max: maxLengthLabel }));
      return;
    }

    if (validateMessage) {
      const validation = validateMessage(trimmedContent);

      if (!validation.isValid) {
        messageApi.error(validation.errorMessage || i18n.t("chat.input.messageFormatInvalid"));
        return;
      }
    }

    const submittedImageIds = images.map((image) => image.id);
    const submission = onSubmit(trimmedContent, images.length > 0 ? images : undefined);
    if (submission instanceof Promise) {
      return submission.then(
        (accepted) => {
          if (accepted !== false) clearImages(submittedImageIds);
        },
        () => undefined,
      );
    }
    if (submission !== false) clearImages(submittedImageIds);
  }, [
    clearImages,
    disabled,
    images,
    isOverCharLimit,
    isInputLocked,
    maxCharCount,
    messageApi,
    onSubmit,
    validateMessage,
    value,
  ]);

  // Tracks IME composition state via composition events. Checked alongside
  // the native `isComposing` keydown flag, which is unreliable on Safari.
  const composingRef = useRef(false);
  const compositionEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCompositionStart = useCallback(() => {
    // A pending async clear from a previous compositionend must not fire
    // mid-composition (composition restarted quickly).
    if (compositionEndTimerRef.current !== null) {
      clearTimeout(compositionEndTimerRef.current);
      compositionEndTimerRef.current = null;
    }
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    // Safari/WKWebView fires compositionend BEFORE the keydown of the
    // candidate-confirming Enter — synchronously, in the same task. Clearing
    // the flag asynchronously keeps that Enter blocked as "still composing",
    // while the user's next deliberate Enter (always a later task) sends.
    compositionEndTimerRef.current = setTimeout(() => {
      compositionEndTimerRef.current = null;
      composingRef.current = false;
    }, 0);
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        onHistoryNavigate &&
        !disabled &&
        !isInputLocked &&
        !event.shiftKey &&
        (event.key === "ArrowUp" || event.key === "ArrowDown")
      ) {
        // Only hijack the arrow keys at the text edges (#169): ArrowUp on
        // the first line, ArrowDown on the last line. In the middle of a
        // multiline draft the keys must move the caret, not replace the
        // draft with a history entry.
        const caret = event.currentTarget?.selectionStart ?? 0;
        const firstNewline = value.indexOf("\n");
        const lastNewline = value.lastIndexOf("\n");
        const onFirstLine = firstNewline === -1 || caret <= firstNewline;
        const onLastLine = lastNewline === -1 || caret > lastNewline;
        const atEdge =
          (event.key === "ArrowUp" && onFirstLine) || (event.key === "ArrowDown" && onLastLine);

        if (atEdge) {
          const direction = event.key === "ArrowUp" ? "previous" : "next";
          const historyValue = onHistoryNavigate(direction, value);
          if (historyValue !== null && historyValue !== undefined) {
            event.preventDefault();
            onChange(historyValue);
            requestAnimationFrame(() => {
              const textArea = textAreaRef.current?.resizableTextArea?.textArea || null;
              if (textArea) {
                const caret = historyValue.length;
                textArea.setSelectionRange(caret, caret);
              }
            });
            return;
          }
        }
      }

      // IME composition guard (#161): during CJK composition, Enter confirms
      // the candidate — it must NOT send the message. Check both the native
      // flag and the composition-event ref (Safari timing).
      if (event.nativeEvent?.isComposing || composingRef.current) {
        return;
      }

      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !isInputLocked &&
        !disabled &&
        !isCommandSelectorVisible
      ) {
        event.preventDefault();
        handleSubmit();
      }
    },
    [
      disabled,
      handleSubmit,
      isInputLocked,
      isCommandSelectorVisible,
      onChange,
      onHistoryNavigate,
      textAreaRef,
      value,
    ],
  );

  const handleRetry = useCallback(
    (mode: MessageRetryMode = "regenerate") => {
      if (isInputLocked || disabled || !onRetry) return;
      onRetry(mode);
    },
    [disabled, isInputLocked, onRetry],
  );

  return {
    handleKeyDown,
    handleSubmit,
    handleRetry,
    compositionProps: {
      onCompositionStart: handleCompositionStart,
      onCompositionEnd: handleCompositionEnd,
    },
  };
};
