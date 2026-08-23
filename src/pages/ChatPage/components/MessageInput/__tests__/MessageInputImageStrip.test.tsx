/**
 * Keyboard-accessibility tests for MessageInputImageStrip thumbnails
 * (issue #58): the image thumbnails were clickable <div>s without
 * role/tabIndex/keyboard handlers.
 */
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { GlobalToken } from "antd/es/theme/interface";

import MessageInputImageStrip from "../MessageInputImageStrip";
import type { ImageFile } from "../../../utils/imageUtils";

const token = {
  marginSM: 12,
  marginXS: 8,
  paddingXXS: 4,
  paddingXS: 8,
  fontSizeSM: 12,
  colorBorderSecondary: "#ddd",
  colorFillSecondary: "#f5f5f5",
} as GlobalToken;

const makeImage = (id: string, name: string): ImageFile => ({
  id,
  name,
  type: "image/png",
  size: 1024,
  file: new File(["x"], name, { type: "image/png" }),
  preview: `data:image/png;base64,${id}`,
  base64: `data:image/png;base64,${id}`,
});

describe("MessageInputImageStrip thumbnail keyboard accessibility", () => {
  const onPreview = vi.fn();
  const onClear = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderStrip = (images: ImageFile[], disabled = false) =>
    render(
      <MessageInputImageStrip
        images={images}
        token={token}
        allowImages={true}
        disabled={disabled}
        onPreview={onPreview}
        onClear={onClear}
      />,
    );

  it("exposes each thumbnail as a focusable, labelled button", () => {
    renderStrip([makeImage("1", "cat.png"), makeImage("2", "dog.png")]);

    const first = screen.getByRole("button", { name: "View image cat.png" });
    const second = screen.getByRole("button", { name: "View image dog.png" });
    expect(first).toHaveAttribute("tabindex", "0");
    expect(second).toHaveAttribute("tabindex", "0");
  });

  it("opens the preview with Enter", () => {
    const image = makeImage("1", "cat.png");
    renderStrip([image]);

    fireEvent.keyDown(screen.getByRole("button", { name: "View image cat.png" }), {
      key: "Enter",
    });

    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onPreview).toHaveBeenCalledWith(image);
  });

  it("opens the preview with Space", () => {
    const image = makeImage("1", "cat.png");
    renderStrip([image]);

    fireEvent.keyDown(screen.getByRole("button", { name: "View image cat.png" }), {
      key: " ",
    });

    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onPreview).toHaveBeenCalledWith(image);
  });

  it("does not open the preview on unrelated keys", () => {
    renderStrip([makeImage("1", "cat.png")]);

    const thumb = screen.getByRole("button", { name: "View image cat.png" });
    fireEvent.keyDown(thumb, { key: "a" });
    fireEvent.keyDown(thumb, { key: "Escape" });

    expect(onPreview).not.toHaveBeenCalled();
  });

  it("still opens the preview on click", () => {
    const image = makeImage("1", "cat.png");
    renderStrip([image]);

    fireEvent.click(screen.getByRole("button", { name: "View image cat.png" }));

    expect(onPreview).toHaveBeenCalledWith(image);
  });

  it("disables image clearing while the submitted snapshot is pending", () => {
    renderStrip([makeImage("1", "cat.png")], true);

    expect(screen.getByRole("button", { name: "Clear all images" })).toBeDisabled();
  });
});
