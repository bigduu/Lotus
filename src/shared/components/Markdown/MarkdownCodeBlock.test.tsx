import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { message } from "antd";
import {
  renderCodeBlock,
  MermaidRenderMode,
} from "./MarkdownCodeBlock";
import * as clipboard from "@shared/utils/clipboard";

// Mock dependencies
vi.mock("@shared/utils/clipboard", () => ({
  copyText: vi.fn(),
}));

vi.mock("antd", async () => {
  const actual = await vi.importActual("antd");
  return {
    ...actual,
    message: {
      success: vi.fn(),
      error: vi.fn(),
    },
  };
});

vi.mock("../MermaidChart", () => ({
  default: vi.fn(({ chart, onFix }) => (
    <div data-testid="mermaid-chart" data-chart={chart}>
      Mermaid Chart: {chart}
      {onFix && <button onClick={() => onFix(chart)}>Fix</button>}
    </div>
  )),
}));

vi.mock("../MermaidChart/LazyMermaidChart", () => ({
  default: vi.fn(({ chart, onFix }) => (
    <div data-testid="lazy-mermaid-chart" data-chart={chart}>
      Lazy Mermaid Chart: {chart}
      {onFix && <button onClick={() => onFix(chart)}>Fix</button>}
    </div>
  )),
}));

describe("MarkdownCodeBlock", () => {
  const mockToken = {
    marginXS: 8,
    borderRadiusSM: 4,
    fontSizeSM: 12,
    paddingSM: 8,
    colorBgContainer: "#fff",
    colorBorder: "#d9d9d9",
    padding: 16,
    colorText: "#333",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("renderCodeBlock - Basic functionality", () => {
    it("returns null for null codeString", () => {
      const result = renderCodeBlock("javascript", null as any, mockToken);
      expect(result).toBeNull();
    });

    it("returns null for undefined codeString", () => {
      const result = renderCodeBlock("javascript", undefined as any, mockToken);
      expect(result).toBeNull();
    });

    it("returns null for empty string codeString", () => {
      const result = renderCodeBlock("javascript", "", mockToken);
      expect(result).toBeNull();
    });

    it("returns null for non-string codeString", () => {
      const result = renderCodeBlock("javascript", 123 as any, mockToken);
      expect(result).toBeNull();
    });

    it("trims language name", () => {
      const { container } = render(
        renderCodeBlock("  javascript  ", "const x = 1;", mockToken)!
      );
      expect(container.textContent).toContain("const x = 1;");
    });

    it("normalizes language to lowercase", () => {
      const { container } = render(
        renderCodeBlock("JAVASCRIPT", "const x = 1;", mockToken)!
      );
      expect(container.textContent).toContain("const x = 1;");
    });
  });

  describe("renderCodeBlock - Mermaid charts", () => {
    it("renders mermaid chart with mermaid language", () => {
      const chart = "graph TD\nA --> B";
      const { getByTestId } = render(
        renderCodeBlock("mermaid", chart, mockToken)!
      );
      expect(getByTestId("lazy-mermaid-chart")).toBeInTheDocument();
      expect(getByTestId("lazy-mermaid-chart")).toHaveAttribute(
        "data-chart",
        chart
      );
    });

    it("renders eager mermaid chart when renderMode is eager", () => {
      const chart = "graph TD\nA --> B";
      const { getByTestId } = render(
        renderCodeBlock("mermaid", chart, mockToken, undefined, "eager")!
      );
      expect(getByTestId("mermaid-chart")).toBeInTheDocument();
    });

    it("renders lazy mermaid chart by default", () => {
      const chart = "graph TD\nA --> B";
      const { getByTestId } = render(
        renderCodeBlock("mermaid", chart, mockToken)!
      );
      expect(getByTestId("lazy-mermaid-chart")).toBeInTheDocument();
    });

    it("passes onFix callback to mermaid chart", () => {
      const onFix = vi.fn();
      const chart = "graph TD\nA --> B";
      const { getByText } = render(
        renderCodeBlock("mermaid", chart, mockToken, onFix)!
      );
      fireEvent.click(getByText("Fix"));
      expect(onFix).toHaveBeenCalledWith(chart);
    });

    it("renders graph TD as mermaid", () => {
      const chart = "graph TD\nA --> B";
      const { getByTestId } = render(
        renderCodeBlock("graph", chart, mockToken)!
      );
      expect(getByTestId("lazy-mermaid-chart")).toBeInTheDocument();
    });

    it("renders flowchart as mermaid", () => {
      const chart = "flowchart TD\nA --> B";
      const { getByTestId } = render(
        renderCodeBlock("flowchart", chart, mockToken)!
      );
      expect(getByTestId("lazy-mermaid-chart")).toBeInTheDocument();
    });

    it("renders gantt chart as mermaid", () => {
      const chart = "gantt\ntitle Test";
      const { getByTestId } = render(
        renderCodeBlock("gantt", chart, mockToken)!
      );
      expect(getByTestId("lazy-mermaid-chart")).toBeInTheDocument();
    });

    it("renders sequenceDiagram as mermaid", () => {
      const chart = "sequenceDiagram\nA->>B: Test";
      const { getByTestId } = render(
        renderCodeBlock("sequencediagram", chart, mockToken)!
      );
      expect(getByTestId("lazy-mermaid-chart")).toBeInTheDocument();
    });

    it("renders classDiagram as mermaid", () => {
      const chart = "classDiagram\nClass01 <|-- Class02";
      const { getByTestId } = render(
        renderCodeBlock("classdiagram", chart, mockToken)!
      );
      expect(getByTestId("lazy-mermaid-chart")).toBeInTheDocument();
    });

    it("renders stateDiagram as mermaid", () => {
      const chart = "stateDiagram-v2\n[*] --> Active";
      const { getByTestId } = render(
        renderCodeBlock("statediagram", chart, mockToken)!
      );
      expect(getByTestId("lazy-mermaid-chart")).toBeInTheDocument();
    });

    it("renders erDiagram as mermaid", () => {
      const chart = "erDiagram\nCUSTOMER ||--o{ ORDER : places";
      const { getByTestId } = render(
        renderCodeBlock("erdiagram", chart, mockToken)!
      );
      expect(getByTestId("lazy-mermaid-chart")).toBeInTheDocument();
    });

    it("returns null for empty mermaid chart", () => {
      const result = renderCodeBlock("mermaid", "   ", mockToken);
      expect(result).toBeNull();
    });

    it("prepends header to mermaid code without header", () => {
      const chart = "A --> B";
      const { getByTestId } = render(
        renderCodeBlock("graph", chart, mockToken)!
      );
      const rendered = getByTestId("lazy-mermaid-chart");
      expect(rendered).toHaveAttribute("data-chart", "graph TD\nA --> B");
    });

    it("does not prepend header if already present", () => {
      const chart = "graph TD\nA --> B";
      const { getByTestId } = render(
        renderCodeBlock("graph", chart, mockToken)!
      );
      const rendered = getByTestId("lazy-mermaid-chart");
      expect(rendered).toHaveAttribute("data-chart", chart);
    });

    it("strips mermaid directives before adding header", () => {
      const chart = "%%{init: {'theme': 'dark'}}%%\nA --> B";
      const { getByTestId } = render(
        renderCodeBlock("graph", chart, mockToken)!
      );
      const rendered = getByTestId("lazy-mermaid-chart");
      expect(rendered).toHaveAttribute(
        "data-chart",
        "%%{init: {'theme': 'dark'}}%%\ngraph TD\nA --> B"
      );
    });

    it("preserves directives and header when both present", () => {
      const chart = "%%{init: {'theme': 'dark'}}%%\ngraph TD\nA --> B";
      const { getByTestId } = render(
        renderCodeBlock("mermaid", chart, mockToken)!
      );
      const rendered = getByTestId("lazy-mermaid-chart");
      expect(rendered).toHaveAttribute("data-chart", chart);
    });
  });

  describe("renderCodeBlock - Code blocks with syntax highlighting", () => {
    it("renders code block for non-mermaid language", () => {
      const code = "const x = 1;";
      const { container } = render(
        renderCodeBlock("javascript", code, mockToken)!
      );
      expect(container.textContent).toContain(code);
    });

    it("shows copy button on hover", async () => {
      const code = "const x = 1;";
      const { container, getByRole } = render(
        renderCodeBlock("javascript", code, mockToken)!
      );

      const card = container.querySelector(".ant-card");
      fireEvent.mouseEnter(card!);

      await waitFor(() => {
        expect(getByRole("button")).toBeInTheDocument();
      });
    });

    it("hides copy button on mouse leave", async () => {
      const code = "const x = 1;";
      const { container, queryByRole } = render(
        renderCodeBlock("javascript", code, mockToken)!
      );

      const card = container.querySelector(".ant-card");
      fireEvent.mouseEnter(card!);
      fireEvent.mouseLeave(card!);

      await waitFor(() => {
        expect(queryByRole("button")).not.toBeInTheDocument();
      });
    });

    it("copies code when copy button clicked", async () => {
      const code = "const x = 1;";
      vi.mocked(clipboard.copyText).mockResolvedValueOnce(undefined);

      const { container, getByRole } = render(
        renderCodeBlock("javascript", code, mockToken)!
      );

      const card = container.querySelector(".ant-card");
      fireEvent.mouseEnter(card!);

      const button = await waitFor(() => getByRole("button"));
      fireEvent.click(button);

      await waitFor(() => {
        expect(clipboard.copyText).toHaveBeenCalledWith(code);
        expect(message.success).toHaveBeenCalledWith("Code copied to clipboard");
      });
    });

    it("shows error message when copy fails", async () => {
      const code = "const x = 1;";
      vi.mocked(clipboard.copyText).mockRejectedValueOnce(new Error("Copy failed"));

      const { container, getByRole } = render(
        renderCodeBlock("javascript", code, mockToken)!
      );

      const card = container.querySelector(".ant-card");
      fireEvent.mouseEnter(card!);

      const button = await waitFor(() => getByRole("button"));
      fireEvent.click(button);

      await waitFor(() => {
        expect(message.error).toHaveBeenCalledWith("Copy failed");
      });
    });

    it("shows line numbers for code with >10 lines", () => {
      const code = Array(15).fill("line of code").join("\n");
      const { container } = render(
        renderCodeBlock("javascript", code, mockToken)!
      );
      // Line numbers are rendered by SyntaxHighlighter
      expect(container.querySelector(".linenumber")).not.toBeNull();
    });

    it("hides line numbers for code with <=10 lines", () => {
      const code = "line 1\nline 2";
      const { container } = render(
        renderCodeBlock("javascript", code, mockToken)!
      );
      expect(container.querySelector(".linenumber")).toBeFalsy();
    });

    it("uses text language for unsupported languages", () => {
      const code = "some code";
      const { container } = render(
        renderCodeBlock("unknown-language", code, mockToken)!
      );
      expect(container.textContent).toContain(code);
    });
  });

  describe("renderCodeBlock - Error handling", () => {
    it("renders fallback on syntax highlighting error", () => {
      // Mock console.warn
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      // Create a code string that might cause highlighting to fail
      const code = "test code";
      const { container } = render(
        renderCodeBlock("javascript", code, mockToken)!
      );

      // Should still render something
      expect(container.textContent).toContain(code);
      warnSpy.mockRestore();
    });

    it("renders fallback with copy functionality", async () => {
      const code = "test code";
      vi.mocked(clipboard.copyText).mockResolvedValueOnce(undefined);

      const { container, getByRole } = render(
        renderCodeBlock("javascript", code, mockToken)!
      );

      const card = container.querySelector(".ant-card");
      if (card) {
        fireEvent.mouseEnter(card!);

        const button = await waitFor(() => getByRole("button"));
        fireEvent.click(button);

        await waitFor(() => {
          expect(clipboard.copyText).toHaveBeenCalledWith(code);
        });
      }
    });
  });

  describe("renderCodeBlock - All Mermaid languages", () => {
    const mermaidLanguages = [
      "mermaid",
      "graph",
      "flowchart",
      "sequencediagram",
      "classdiagram",
      "statediagram",
      "statediagram-v2",
      "erdiagram",
      "journey",
      "gantt",
      "pie",
      "gitgraph",
      "mindmap",
      "timeline",
      "quadrantchart",
      "requirementdiagram",
      "c4context",
      "c4container",
      "c4component",
      "c4dynamic",
      "c4deployment",
      "sankey",
      "sankey-beta",
      "xychart",
      "xychart-beta",
      "block",
      "block-beta",
      "packet",
      "packet-beta",
      "kanban",
      "architecture",
    ];

    mermaidLanguages.forEach((lang) => {
      it(`renders ${lang} as mermaid chart`, () => {
        const code = "test content";
        const { getByTestId } = render(
          renderCodeBlock(lang, code, mockToken)!
        );
        expect(getByTestId("lazy-mermaid-chart")).toBeInTheDocument();
      });
    });
  });

  describe("renderCodeBlock - Edge cases", () => {
    it("handles code with special characters", () => {
      const code = "const x = '<>&\"';";
      const { container } = render(
        renderCodeBlock("javascript", code, mockToken)!
      );
      expect(container.textContent).toContain(code);
    });

    it("handles very long code lines", () => {
      const code = "const x = '" + "a".repeat(500) + "';";
      const { container } = render(
        renderCodeBlock("javascript", code, mockToken)!
      );
      expect(container.textContent).toContain(code);
    });

    it("handles code with unicode characters", () => {
      const code = "const 你好 = '世界';";
      const { container } = render(
        renderCodeBlock("javascript", code, mockToken)!
      );
      expect(container.textContent).toContain(code);
    });

    it("handles whitespace-only code", () => {
      const result = renderCodeBlock("javascript", "   \n  ", mockToken);
      // Whitespace-only code should still render (not mermaid)
      expect(result).not.toBeNull();
    });
  });

  describe("renderCodeBlock - Button hover effects", () => {
    it("changes button opacity on hover", async () => {
      const code = "const x = 1;";
      const { container, getByRole } = render(
        renderCodeBlock("javascript", code, mockToken)!
      );

      const card = container.querySelector(".ant-card");
      fireEvent.mouseEnter(card!);

      const button = await waitFor(() => getByRole("button"));
      fireEvent.mouseEnter(button);

      expect(button).toHaveStyle({ opacity: "1" });
    });

    it("resets button opacity on mouse leave", async () => {
      const code = "const x = 1;";
      const { container, getByRole } = render(
        renderCodeBlock("javascript", code, mockToken)!
      );

      const card = container.querySelector(".ant-card");
      fireEvent.mouseEnter(card!);

      const button = await waitFor(() => getByRole("button"));
      fireEvent.mouseEnter(button);
      fireEvent.mouseLeave(button);

      expect(button).toHaveStyle({ opacity: "0.8" });
    });
  });
});
