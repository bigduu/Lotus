import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { createMarkdownComponents } from "./markdownComponents";

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

describe("createMarkdownComponents", () => {
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
});
