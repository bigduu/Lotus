import type { GlobalToken } from "antd/es/theme/interface";
import React from "react";
import { Input } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { useIsMobile } from "@shared/hooks/useMediaQuery";

const { TextArea } = Input;

interface HighlightSegment {
  type: "workflow" | "file" | "text";
  text: string;
}

interface MessageInputFieldProps {
  value: string;
  placeholder: string;
  disabled: boolean;
  token: GlobalToken;
  highlightSegments: HighlightSegment[];
  textAreaRef: React.RefObject<TextAreaRef>;
  highlightOverlayRef: React.RefObject<HTMLDivElement>;
  onChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onScrollSync: () => void;
}

const MessageInputField: React.FC<MessageInputFieldProps> = ({
  value,
  placeholder,
  disabled,
  token,
  highlightSegments,
  textAreaRef,
  highlightOverlayRef,
  onChange,
  onKeyDown,
  onPaste,
  onScrollSync,
}) => {
  const isMobile = useIsMobile();
  const showHighlightOverlay =
    value.length > 0 && highlightSegments.some((segment) => segment.type !== "text");
  // iOS Safari auto-zooms when a focused input's font is < 16px; the mobile
  // density theme uses 13px, so the composer input (and its highlight overlay,
  // which must match exactly) is pinned to 16px on phones to suppress the zoom.
  const inputFontSize = isMobile ? 16 : token.fontSize;
  const inputPadding = "6px 4px";
  const inputLineHeight = 1.65;
  const inputTextColor = disabled ? token.colorTextDisabled : token.colorText;

  return (
    <div
      style={{
        position: "relative",
        flex: 1,
      }}
    >
      {showHighlightOverlay ? (
        <div
          ref={highlightOverlayRef}
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            padding: inputPadding,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            overflowWrap: "anywhere",
            overflow: "hidden",
            pointerEvents: "none",
            color: "transparent",
            fontSize: inputFontSize,
            lineHeight: inputLineHeight,
            fontFamily: "inherit",
            fontWeight: 400,
            letterSpacing: "normal",
            transform: "translate(0, 0)",
            zIndex: 0,
          }}
        >
          {highlightSegments.map((segment, index) => {
            let style: React.CSSProperties | undefined;
            if (segment.type === "workflow") {
              style = {
                backgroundColor: token.colorPrimaryBg,
                color: "transparent",
                WebkitTextFillColor: "transparent",
                fontWeight: 400,
                textDecoration: "underline",
                textDecorationStyle: "dotted",
                textDecorationColor: token.colorPrimary,
              };
            } else if (segment.type === "file") {
              style = {
                backgroundColor: token.colorSuccessBg,
                color: "transparent",
                WebkitTextFillColor: "transparent",
              };
            }
            return (
              <span key={`segment-${index}`} style={style}>
                {segment.text}
              </span>
            );
          })}
          {value.endsWith("\n") ? "\n" : null}
        </div>
      ) : null}
      <TextArea
        data-testid="chat-input"
        ref={textAreaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        placeholder={placeholder}
        disabled={disabled}
        autoSize={{ minRows: isMobile ? 1 : 3, maxRows: isMobile ? 6 : 8 }}
        variant="borderless"
        onScroll={onScrollSync}
        className="lotus-message-input-field"
        style={{
          resize: "none",
          flex: 1,
          fontSize: inputFontSize,
          padding: inputPadding,
          lineHeight: inputLineHeight,
          border: "none",
          outline: "none",
          background: "transparent",
          color: inputTextColor,
          WebkitTextFillColor: inputTextColor,
          caretColor: inputTextColor,
          position: "relative",
          zIndex: 1,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          overflowWrap: "anywhere",
          overflowY: "auto",
        }}
      />
    </div>
  );
};

export default MessageInputField;
