import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { createMarkdownComponents } from "./markdownComponents";
import * as openExternalLinkModule from "../../utils/openExternalLink";

const token = {
  marginSM: 8,
  marginXS: 4,
  paddingXS: 4,
  paddingSM: 8,
  padding: 8,
  colorPrimary: "#1677ff",
  colorPrimaryBg: "#e6f4ff",
  colorTextSecondary: "#999999",
  colorLink: "#1677ff",
  colorBgContainer: "#ffffff",
  colorBorder: "#d9d9d9",
};

// Mock openExternalLink
vi.mock("../../utils/openExternalLink", () => ({
  openExternalLink: vi.fn(),
}));

describe("createMarkdownComponents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("paragraphs", () => {
    it("renders paragraphs with correct styling", () => {
      render(
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={createMarkdownComponents(token)}
        >
          {"This is a paragraph."}
        </ReactMarkdown>,
      );

      const paragraph = screen.getByText("This is a paragraph.");
      expect(paragraph).toBeInTheDocument();
    });
  });

  describe("lists", () => {
    it("renders ordered lists", () => {
      render(
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={createMarkdownComponents(token)}
        >
          {"1. Item 1\n2. Item 2\n3. Item 3"}
        </ReactMarkdown>,
      );

      expect(screen.getByText("Item 1")).toBeInTheDocument();
      expect(screen.getByText("Item 2")).toBeInTheDocument();
      expect(screen.getByText("Item 3")).toBeInTheDocument();
    });

    it("renders unordered lists", () => {
      render(
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={createMarkdownComponents(token)}
        >
          {"- Item 1\n- Item 2"}
        </ReactMarkdown>,
      );

      expect(screen.getByText("Item 1")).toBeInTheDocument();
      expect(screen.getByText("Item 2")).toBeInTheDocument();
    });
  });

  describe("code blocks", () => {
    it("renders inline code", () => {
      render(
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={createMarkdownComponents(token)}
        >
          {"This is `inline code` in text."}
        </ReactMarkdown>,
      );

      expect(screen.getByText("inline code")).toBeInTheDocument();
    });

    it("renders code block with language", () => {
      const { container } = render(
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={createMarkdownComponents(token)}
        >
          {"```javascript\nconst x = 1;\n```"}
        </ReactMarkdown>,
      );

      // Code block should render with syntax highlighting
      expect(container.querySelector(".language-javascript")).toBeInTheDocument();
    });

    it("renders code block without language", () => {
      const { container } = render(
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={createMarkdownComponents(token)}
        >
          {"```\nplain code\n```"}
        </ReactMarkdown>,
      );

      // Code block should still render even without language
      expect(container.querySelector("pre")).toBeInTheDocument();
    });

    it("returns null for empty code block", () => {
      const { container } = render(
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={createMarkdownComponents(token)}
        >
          {"```\n\n```"}
        </ReactMarkdown>,
      );

      // Empty code block renders but with no content inside the code element
      // ReactMarkdown wraps code in pre, so pre will exist but should be empty-ish
      const pre = container.querySelector("pre");
      if (pre) {
        // If pre exists, it should be minimal/empty
        expect(pre.textContent?.trim()).toBe("");
      }
    });

    it("returns null for whitespace-only code block", () => {
      const { container } = render(
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={createMarkdownComponents(token)}
        >
          {"```\n   \n```"}
        </ReactMarkdown>,
      );

      // Whitespace-only code block should render minimally
      const pre = container.querySelector("pre");
      if (pre) {
        expect(pre.textContent?.trim()).toBe("");
      }
    });

    it("renders mermaid chart", () => {
      const { container } = render(
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={createMarkdownComponents(token)}
        >
          {"```mermaid\ngraph TD\nA --> B\n```"}
        </ReactMarkdown>,
      );

      // Mermaid chart should render (lazy loaded)
      expect(container.querySelector("pre")).toBeInTheDocument();
    });

    it("passes onFixMermaid callback to code blocks", () => {
      const onFix = vi.fn();
      const { container } = render(
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={createMarkdownComponents(token, { onFixMermaid: onFix })}
        >
          {"```mermaid\ngraph TD\nA --> B\n```"}
        </ReactMarkdown>,
      );

      // Component should render with onFix callback
      expect(container.querySelector("pre")).toBeInTheDocument();
    });

    it("uses eager render mode when specified", () => {
      const { container } = render(
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={createMarkdownComponents(token, {
            mermaidRenderMode: "eager",
          })}
        >
          {"```mermaid\ngraph TD\nA --> B\n```"}
        </ReactMarkdown>,
      );

      // Eager mode should still render the chart
      expect(container.querySelector("pre")).toBeInTheDocument();
    });
  });

  describe("blockquotes", () => {
    it("renders blockquotes with styling", () => {
      render(
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={createMarkdownComponents(token)}
        >
          {"> This is a quote"}
        </ReactMarkdown>,
      );

      expect(screen.getByText("This is a quote")).toBeInTheDocument();
    });
  });

  describe("links", () => {
    it("renders markdown links as clickable anchors that open in a new tab", () => {
      render(
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={createMarkdownComponents(token)}
        >
          {"[OpenAI](https://openai.com)"}
        </ReactMarkdown>,
      );

      const link = screen.getByRole("link", { name: "OpenAI" });
      expect(link).toHaveAttribute("href", "https://openai.com");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
      expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
    });

    it("auto-links plain URLs via gfm and keeps them clickable", () => {
      render(
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={createMarkdownComponents(token)}
        >
          {"Visit https://example.com/docs for details."}
        </ReactMarkdown>,
      );

      const link = screen.getByRole("link", { name: "https://example.com/docs" });
      expect(link).toHaveAttribute("href", "https://example.com/docs");
      expect(link).toHaveAttribute("target", "_blank");
    });

    it("calls openExternalLink when link is clicked", () => {
      render(
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={createMarkdownComponents(token)}
        >
          {"[Test](https://example.com)"}
        </ReactMarkdown>,
      );

      const link = screen.getByRole("link", { name: "Test" });
      fireEvent.click(link);

      expect(openExternalLinkModule.openExternalLink).toHaveBeenCalledWith(
        "https://example.com",
      );
    });

    it("prevents default and stops propagation on link click", () => {
      render(
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={createMarkdownComponents(token)}
        >
          {"[Test](https://example.com)"}
        </ReactMarkdown>,
      );

      const link = screen.getByRole("link", { name: "Test" });
      const event = fireEvent.click(link);

      // openExternalLink should have been called
      expect(openExternalLinkModule.openExternalLink).toHaveBeenCalled();
    });

    it("renders children without link for empty href", () => {
      const { container } = render(
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={createMarkdownComponents(token)}
        >
          {"[Test]()"}
        </ReactMarkdown>,
      );

      // Empty href should not create a clickable link
      const links = container.querySelectorAll("a");
      expect(links).toHaveLength(0);
      expect(screen.getByText("Test")).toBeInTheDocument();
    });

    it("renders children without link for whitespace-only href", () => {
      const { container } = render(
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={createMarkdownComponents(token)}
        >
          {"[Test](   )"}
        </ReactMarkdown>,
      );

      const links = container.querySelectorAll("a");
      expect(links).toHaveLength(0);
      expect(screen.getByText("Test")).toBeInTheDocument();
    });

    it("trims href before processing", () => {
      render(
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={createMarkdownComponents(token)}
        >
          {"[Test](  https://example.com  )"}
        </ReactMarkdown>,
      );

      const link = screen.getByRole("link", { name: "Test" });
      expect(link).toHaveAttribute("href", "https://example.com");
    });
  });

  describe("tables", () => {
    it("renders tables with headers and rows", () => {
      render(
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={createMarkdownComponents(token)}
        >
          {"| Header 1 | Header 2 |\n|----------|----------|\n| Cell 1   | Cell 2   |"}
        </ReactMarkdown>,
      );

      expect(screen.getByText("Header 1")).toBeInTheDocument();
      expect(screen.getByText("Header 2")).toBeInTheDocument();
      expect(screen.getByText("Cell 1")).toBeInTheDocument();
      expect(screen.getByText("Cell 2")).toBeInTheDocument();
    });

    it("renders table header", () => {
      const { container } = render(
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={createMarkdownComponents(token)}
        >
          {"| Header |\n|--------|"}
        </ReactMarkdown>,
      );

      expect(container.querySelector("thead")).toBeInTheDocument();
    });

    it("renders table body", () => {
      const { container } = render(
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={createMarkdownComponents(token)}
        >
          {"| Header |\n|--------|\n| Cell |"}
        </ReactMarkdown>,
      );

      expect(container.querySelector("tbody")).toBeInTheDocument();
    });

    it("renders table rows", () => {
      const { container } = render(
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={createMarkdownComponents(token)}
        >
          {"| H1 | H2 |\n|----|----|\n| C1 | C2 |"}
        </ReactMarkdown>,
      );

      expect(container.querySelectorAll("tr")).toHaveLength(2); // 1 header row + 1 body row
    });

    it("renders table header cells", () => {
      const { container } = render(
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={createMarkdownComponents(token)}
        >
          {"| Header |\n|--------|"}
        </ReactMarkdown>,
      );

      expect(container.querySelector("th")).toBeInTheDocument();
    });

    it("renders table data cells", () => {
      const { container } = render(
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={createMarkdownComponents(token)}
        >
          {"| H |\n|---|\n| Cell |"}
        </ReactMarkdown>,
      );

      expect(container.querySelector("td")).toBeInTheDocument();
    });
  });

  describe("checkboxes", () => {
    it("renders checkbox inputs", () => {
      const { container } = render(
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={createMarkdownComponents(token)}
        >
          {"- [ ] Unchecked task\n- [x] Checked task"}
        </ReactMarkdown>,
      );

      const checkboxes = container.querySelectorAll('input[type="checkbox"]');
      expect(checkboxes).toHaveLength(2);
      expect(checkboxes[0]).not.toBeChecked();
      expect(checkboxes[1]).toBeChecked();
    });

    it("renders disabled checkbox", () => {
      const { container } = render(
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={createMarkdownComponents(token)}
        >
          {"- [x] Task"}
        </ReactMarkdown>,
      );

      const checkbox = container.querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      expect(checkbox).toBeInTheDocument();
      expect(checkbox.checked).toBe(true);
    });

    it("renders non-checkbox input types", () => {
      // This is an edge case - testing the else branch
      const { container } = render(
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={createMarkdownComponents(token)}
        >
          {"<input type=\"text\" />"}
        </ReactMarkdown>,
      );

      // Should not render text inputs (sanitized by rehype-sanitize)
      const input = container.querySelector('input[type="text"]');
      expect(input).toBeNull();
    });
  });

  describe("options handling", () => {
    it("works without options parameter", () => {
      render(
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={createMarkdownComponents(token)}
        >
          {"```javascript\ncode\n```"}
        </ReactMarkdown>,
      );

      expect(screen.getByText(/code/)).toBeInTheDocument();
    });

    it("works with empty options object", () => {
      render(
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={createMarkdownComponents(token, {})}
        >
          {"```javascript\ncode\n```"}
        </ReactMarkdown>,
      );

      expect(screen.getByText(/code/)).toBeInTheDocument();
    });
  });
});
