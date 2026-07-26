import { render, screen } from "@testing-library/react";
import { theme as antdTheme } from "antd";
import { describe, expect, it, vi } from "vitest";

import MessageInputControlsRight from "./MessageInputControlsRight";

const { defaultAlgorithm, defaultSeed } = antdTheme;
const testToken = { ...defaultSeed, ...defaultAlgorithm(defaultSeed) };

const baseProps = {
  allowRetry: false,
  hasMessages: false,
  isStreaming: false,
  isInputLocked: false,
  disabled: false,
  onSubmit: vi.fn(),
  value: "",
  images: [],
  isOverCharLimit: false,
  token: testToken,
} as const;

describe("MessageInputControlsRight — cancel affordance (#169)", () => {
  it("shows a disabled, explained cancel button when the session is busy but no cancel is wired", () => {
    render(<MessageInputControlsRight {...baseProps} canCancel={true} onCancel={undefined} />);

    const button = screen.getByTestId("cancel-button");
    expect(button).toBeDisabled();
    // An explanation, not an infinite spinner.
    expect(button).toHaveAttribute("title", "Cannot cancel in the current state");
    expect(button).toHaveAttribute("aria-label", "Cannot cancel in the current state");
    expect(button.querySelector(".ant-btn-loading-icon")).toBeNull();
  });

  it("shows an enabled cancel button when a cancel handler exists", () => {
    const onCancel = vi.fn();
    render(<MessageInputControlsRight {...baseProps} canCancel={true} onCancel={onCancel} />);

    const button = screen.getByTestId("cancel-button");
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("title", "Cancel request");

    button.click();
    expect(onCancel).toHaveBeenCalled();
  });
});
