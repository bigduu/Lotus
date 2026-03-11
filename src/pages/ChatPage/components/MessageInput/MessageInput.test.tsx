import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessageInput } from "./index";

describe("MessageInput", () => {
  const interaction = {
    isStreaming: false,
    hasMessages: false,
  };

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

    expect(onSubmit).toHaveBeenCalledWith(longContent, undefined);
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
});
