import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ActionButtonGroup, { createCopyButton, createReferenceButton } from "../ActionButtonGroup";
import FilePreview from "../FilePreview";
import FileReferenceCard from "../FileReferenceCard";
import ImageGrid from "../ImageGrid";
import MessageFeedback from "../MessageFeedback";
import type { ProcessedFile } from "../../utils/fileUtils";
import type { MessageImage } from "@shared/types/chat";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));

const processedFile: ProcessedFile = {
  id: "file-1",
  file: new File(["hello"], "notes.txt", { type: "text/plain" }),
  name: "notes.txt",
  size: 2_048,
  type: "text/plain",
  kind: "text",
  content: "hello",
  preview: "hello",
  lastModified: 1,
};

describe("FilePreview", () => {
  it("renders attachment metadata and wires per-file removal and clear-all", () => {
    const onRemove = vi.fn();
    const onClear = vi.fn();
    const { container } = render(
      <FilePreview files={[processedFile]} onRemove={onRemove} onClear={onClear} />,
    );

    expect(screen.getByText("notes.txt")).toBeInTheDocument();
    expect(screen.getByText('chat.filePreview.fileCount:{"count":1}')).toBeInTheDocument();

    const removeButton = container.querySelector(".ant-tag-close-icon");
    expect(removeButton).not.toBeNull();
    fireEvent.click(removeButton as Element);
    fireEvent.click(screen.getByRole("button", { name: /common\.clear/ }));

    expect(onRemove).toHaveBeenCalledWith("file-1");
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("renders nothing without files", () => {
    const { container } = render(<FilePreview files={[]} onRemove={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("MessageFeedback", () => {
  it("toggles ratings and invokes retry variations by pointer and keyboard", () => {
    const onRetryWithVariation = vi.fn();
    const { container } = render(
      <MessageFeedback
        messageId="message-1"
        isVisible
        onRetryWithVariation={onRetryWithVariation}
      />,
    );

    const root = container.querySelector('[data-message-id="message-1"]');
    const like = screen.getByRole("button", { name: "feedback.helpful" });
    const dislike = screen.getByRole("button", { name: "feedback.notHelpful" });

    fireEvent.click(like);
    expect(like).toHaveClass("is-liked");
    expect(root).toHaveClass("has-rating", "is-visible");

    fireEvent.click(dislike);
    expect(dislike).toHaveClass("is-disliked");
    fireEvent.click(screen.getByRole("button", { name: "feedback.retry.shorter" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "feedback.retry.actionable" }), {
      key: "Enter",
    });

    expect(onRetryWithVariation).toHaveBeenNthCalledWith(
      1,
      "Please give a shorter, more concise answer:",
    );
    expect(onRetryWithVariation).toHaveBeenNthCalledWith(
      2,
      "Please make your answer more actionable with specific steps:",
    );

    fireEvent.click(dislike);
    expect(
      screen.queryByRole("button", { name: "feedback.retry.shorter" }),
    ).not.toBeInTheDocument();
  });
});

describe("ImageGrid", () => {
  const images: MessageImage[] = [
    {
      id: "url-image",
      url: "https://example.test/screenshot.png",
      name: "screenshot.png",
      size: 2_048,
      type: "image/png",
      width: 800,
      height: 600,
      ocrText: "Recognized text",
    },
    {
      id: "inline-image",
      base64: "data:image/png;base64,AAAA",
      name: "inline.png",
      size: 1_024,
      type: "image/png",
      ocrError: "OCR unavailable",
    },
  ];

  it("chooses URL/base64 sources and exposes image and OCR metadata", () => {
    render(<ImageGrid images={images} maxHeight={{ single: 321, multiple: 123 }} />);

    expect(screen.getByAltText("screenshot.png")).toHaveAttribute(
      "src",
      "https://example.test/screenshot.png",
    );
    expect(screen.getByAltText("screenshot.png")).toHaveStyle({ maxHeight: "123px" });
    expect(screen.getByAltText("inline.png")).toHaveAttribute("src", "data:image/png;base64,AAAA");
    expect(screen.getByText("2.0 KB • 800×600")).toBeInTheDocument();
    const ocrToggles = screen.getAllByRole("button", { name: /components\.imageGrid\.ocr/ });
    expect(ocrToggles).toHaveLength(2);
    ocrToggles.forEach((toggle) => fireEvent.click(toggle));
    expect(screen.getByText("Recognized text")).toBeInTheDocument();
    expect(screen.getByText("OCR unavailable")).toBeInTheDocument();
  });

  it("renders nothing for an empty image list", () => {
    const { container } = render(<ImageGrid images={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ActionButtonGroup", () => {
  it("applies visibility/position and preserves click and disabled behavior", () => {
    const onCopy = vi.fn();
    const onReference = vi.fn();
    const { container, rerender } = render(
      <ActionButtonGroup
        isVisible={false}
        position={{ top: 4, left: 6 }}
        buttons={[
          createCopyButton(onCopy, "Copy now"),
          { ...createReferenceButton(onReference, "Reference now"), disabled: true },
        ]}
      />,
    );

    expect(container.firstChild).toHaveStyle({
      opacity: "0",
      pointerEvents: "none",
      top: "4px",
      left: "6px",
    });
    expect(screen.getByTestId("copy-message")).toBeEnabled();
    expect(screen.getByTestId("reference")).toBeDisabled();

    rerender(
      <ActionButtonGroup
        isVisible
        buttons={[
          createCopyButton(onCopy, "Copy now"),
          createReferenceButton(onReference, "Reference now"),
        ]}
      />,
    );
    fireEvent.click(screen.getByTestId("copy-message"));
    fireEvent.click(screen.getByTestId("reference"));
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onReference).toHaveBeenCalledTimes(1);
  });
});

describe("FileReferenceCard", () => {
  it("distinguishes files from folders, shows directories, and removes @references from the question", () => {
    render(
      <FileReferenceCard
        paths={["/repo/src/main.ts", "/repo/docs"]}
        displayText="@main.ts Please review @docs"
      />,
    );

    expect(screen.getByText("main.ts")).toBeInTheDocument();
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("/repo/src")).toBeInTheDocument();
    expect(screen.getByText("/repo")).toBeInTheDocument();
    expect(screen.getByText("Please review")).toBeInTheDocument();
    expect(screen.queryByText("@main.ts Please review @docs")).not.toBeInTheDocument();
  });
});
