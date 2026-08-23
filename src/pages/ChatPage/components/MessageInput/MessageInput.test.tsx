import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessageInput } from "./index";

describe("MessageInput", () => {
  const interaction = {
    isStreaming: false,
    hasMessages: false,
  };

  it("keeps textarea text visible when input highlighting is active", () => {
    render(
      <MessageInput
        value="/workflow review @src/main.ts and continue"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        interaction={interaction}
        allowImages={false}
      />,
    );

    const input = screen.getByTestId("chat-input");
    const inlineStyle = input.getAttribute("style") ?? "";

    expect(inlineStyle).not.toContain("color: transparent");
    expect(inlineStyle).not.toContain("-webkit-text-fill-color: transparent");
  });

  it("allows sending long content when maxCharCount is not set", () => {
    const longContent = "a".repeat(9001);
    const onSubmit = vi.fn();

    render(
      <MessageInput
        value={longContent}
        onChange={vi.fn()}
        onSubmit={onSubmit}
        interaction={interaction}
        allowImages={false}
      />,
    );

    const sendButton = screen.getByTestId("send-button");
    expect(sendButton).toBeEnabled();

    fireEvent.click(sendButton);

    expect(onSubmit).toHaveBeenCalledWith(longContent, undefined, longContent);
  });

  it("blocks sending when content exceeds configured maxCharCount", () => {
    const longContent = "a".repeat(9001);
    const onSubmit = vi.fn();

    render(
      <MessageInput
        value={longContent}
        onChange={vi.fn()}
        onSubmit={onSubmit}
        interaction={interaction}
        allowImages={false}
        maxCharCount={8000}
      />,
    );

    const sendButton = screen.getByTestId("send-button");
    expect(sendButton).toBeDisabled();

    fireEvent.click(sendButton);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("9,001 / 8,000")).toBeInTheDocument();
  });

  it("shows a cancel button while input is locked even before tokens start streaming", () => {
    const onCancel = vi.fn();

    render(
      <MessageInput
        value="hello"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        interaction={{
          isStreaming: false,
          isInputLocked: true,
          hasMessages: true,
          onCancel,
        }}
        allowImages={false}
      />,
    );

    const cancelButton = screen.getByTestId("cancel-button");
    expect(cancelButton).toBeEnabled();

    fireEvent.click(cancelButton);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows cancel button when legacy running fallback is active while input is locked", () => {
    render(
      <MessageInput
        value="hello"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        interaction={{
          isStreaming: false,
          isInputLocked: true,
          canCancel: true,
          hasMessages: true,
          onCancel: vi.fn(),
        }}
        allowImages={false}
      />,
    );

    expect(screen.getByTestId("cancel-button")).toBeInTheDocument();
  });

  it("shows retry spinner while execution is locked even before visible token streaming starts", () => {
    render(
      <MessageInput
        value="hello"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        interaction={{
          isStreaming: false,
          isInputLocked: true,
          hasMessages: true,
          allowRetry: true,
          onRetry: vi.fn(),
          onCancel: vi.fn(),
        }}
        allowImages={false}
      />,
    );

    const regenerateButton = screen.getByTestId("regenerate-button");
    expect(regenerateButton.querySelector(".anticon-spin")).not.toBeNull();
    expect(regenerateButton).toBeDisabled();
  });

  it("keeps send button disabled when input is locked but not cancellable", () => {
    render(
      <MessageInput
        value="hello"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        interaction={{
          isStreaming: false,
          isInputLocked: true,
          canCancel: false,
          hasMessages: true,
          allowRetry: true,
          onRetry: vi.fn(),
        }}
        allowImages={false}
      />,
    );

    const sendButton = screen.getByTestId("send-button");
    expect(sendButton).toBeDisabled();
  });
});
