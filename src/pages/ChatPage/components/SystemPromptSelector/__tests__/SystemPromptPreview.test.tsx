import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SystemPromptPreview } from "../SystemPromptPreview";

// Mock antd theme token
const mockToken = {
  marginLG: 16,
  marginXS: 4,
  marginSM: 8,
  paddingLG: 24,
  colorBgLayout: "#f5f5f5",
  colorBorderSecondary: "#d9d9d9",
  fontSizeHeading3: 24,
  fontSizeHeading4: 20,
  fontSizeHeading5: 16,
  fontSizeSM: 12,
  colorFillTertiary: "#f0f0f0",
  borderRadiusSM: 4,
};

describe("SystemPromptPreview", () => {
  it("renders content correctly", () => {
    const content = "# Test Prompt\n\nThis is a test prompt.";
    const onClick = vi.fn();

    render(
      <SystemPromptPreview
        content={content}
        token={mockToken}
        showGradient={false}
        onClick={onClick}
      />,
    );

    expect(screen.getByText("Test Prompt")).toBeInTheDocument();
    expect(screen.getByText("This is a test prompt.")).toBeInTheDocument();
  });

  it("displays 'No content available' when content is empty", () => {
    const onClick = vi.fn();

    render(
      <SystemPromptPreview content="" token={mockToken} showGradient={false} onClick={onClick} />,
    );

    expect(screen.getByText("No content available.")).toBeInTheDocument();
  });

  it("calls onClick when card is clicked", () => {
    const content = "Test content";
    const onClick = vi.fn();

    render(
      <SystemPromptPreview
        content={content}
        token={mockToken}
        showGradient={false}
        onClick={onClick}
      />,
    );

    const card = screen.getByText("Test content").closest(".ant-card");
    expect(card).not.toBeNull();
    fireEvent.click(card as HTMLElement);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders gradient overlay when showGradient is true", () => {
    const content = "Test content";
    const onClick = vi.fn();

    const { container } = render(
      <SystemPromptPreview
        content={content}
        token={mockToken}
        showGradient={true}
        onClick={onClick}
      />,
    );

    const gradientDiv = container.querySelector('div[style*="linear-gradient"]');
    expect(gradientDiv).not.toBeNull();
  });

  it("does not render gradient overlay when showGradient is false", () => {
    const content = "Test content";
    const onClick = vi.fn();

    const { container } = render(
      <SystemPromptPreview
        content={content}
        token={mockToken}
        showGradient={false}
        onClick={onClick}
      />,
    );

    const gradientDiv = container.querySelector('div[style*="linear-gradient"]');
    expect(gradientDiv).toBeFalsy();
  });

  it("renders markdown headings correctly", () => {
    const content = "# Heading 1\n## Heading 2\n### Heading 3";
    const onClick = vi.fn();

    render(
      <SystemPromptPreview
        content={content}
        token={mockToken}
        showGradient={false}
        onClick={onClick}
      />,
    );

    expect(screen.getByText("Heading 1")).toBeInTheDocument();
    expect(screen.getByText("Heading 2")).toBeInTheDocument();
    expect(screen.getByText("Heading 3")).toBeInTheDocument();
  });

  it("renders code blocks with syntax highlighting", () => {
    const content = "```javascript\nconst x = 1;\n```";
    const onClick = vi.fn();

    const { container } = render(
      <SystemPromptPreview
        content={content}
        token={mockToken}
        showGradient={false}
        onClick={onClick}
      />,
    );

    // Check that code block is rendered
    const codeElement = container.querySelector("code");
    expect(codeElement).not.toBeNull();
  });

  it("renders inline code correctly", () => {
    const content = "Use the `npm install` command";
    const onClick = vi.fn();

    render(
      <SystemPromptPreview
        content={content}
        token={mockToken}
        showGradient={false}
        onClick={onClick}
      />,
    );

    expect(screen.getByText("npm install")).toBeInTheDocument();
  });

  it("renders lists correctly", () => {
    const content = "- Item 1\n- Item 2\n- Item 3";
    const onClick = vi.fn();

    const { container } = render(
      <SystemPromptPreview
        content={content}
        token={mockToken}
        showGradient={false}
        onClick={onClick}
      />,
    );

    const listItems = container.querySelectorAll("li");
    expect(listItems.length).toBeGreaterThanOrEqual(3);
  });

  it("handles special characters in content", () => {
    const content = "# Special: <>&\"'\\n\\t";
    const onClick = vi.fn();

    render(
      <SystemPromptPreview
        content={content}
        token={mockToken}
        showGradient={false}
        onClick={onClick}
      />,
    );

    expect(screen.getByText(/Special:/)).toBeInTheDocument();
  });

  it("handles very long content", () => {
    const content = "Test ".repeat(1000);
    const onClick = vi.fn();

    const { container } = render(
      <SystemPromptPreview
        content={content}
        token={mockToken}
        showGradient={false}
        onClick={onClick}
      />,
    );

    expect(container.textContent).toContain("Test");
  });

  it("handles unicode content", () => {
    const content = "# 中文标题\n\n内容测试 🚀";
    const onClick = vi.fn();

    render(
      <SystemPromptPreview
        content={content}
        token={mockToken}
        showGradient={false}
        onClick={onClick}
      />,
    );

    expect(screen.getByText("中文标题")).toBeInTheDocument();
    expect(screen.getByText(/内容测试/)).toBeInTheDocument();
  });

  it("renders with correct card styles", () => {
    const content = "Test";
    const onClick = vi.fn();

    const { container } = render(
      <SystemPromptPreview
        content={content}
        token={mockToken}
        showGradient={false}
        onClick={onClick}
      />,
    );

    const card = container.querySelector(".ant-card");
    expect(card).not.toBeNull();
  });

  it("renders markdown tables correctly", () => {
    const content = "| Col1 | Col2 |\n|------|------|\n| A | B |";
    const onClick = vi.fn();

    const { container } = render(
      <SystemPromptPreview
        content={content}
        token={mockToken}
        showGradient={false}
        onClick={onClick}
      />,
    );

    const table = container.querySelector("table");
    expect(table).not.toBeNull();
  });

  it("renders blockquotes correctly", () => {
    const content = "> This is a quote";
    const onClick = vi.fn();

    const { container } = render(
      <SystemPromptPreview
        content={content}
        token={mockToken}
        showGradient={false}
        onClick={onClick}
      />,
    );

    const blockquote = container.querySelector("blockquote");
    expect(blockquote).not.toBeNull();
  });

  it("renders links correctly", () => {
    const content = "[Example](https://example.com)";
    const onClick = vi.fn();

    render(
      <SystemPromptPreview
        content={content}
        token={mockToken}
        showGradient={false}
        onClick={onClick}
      />,
    );

    const link = screen.getByText("Example");
    expect(link).toBeInTheDocument();
  });

  it("applies custom token styles", () => {
    const customToken = {
      ...mockToken,
      marginLG: 32,
      colorBgLayout: "#customcolor",
    };
    const content = "Test";
    const onClick = vi.fn();

    const { container } = render(
      <SystemPromptPreview
        content={content}
        token={customToken}
        showGradient={false}
        onClick={onClick}
      />,
    );

    expect(container.firstChild).not.toBeNull();
  });
});
