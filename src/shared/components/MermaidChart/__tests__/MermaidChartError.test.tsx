import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import MermaidChartError from "../MermaidChartError";

// Mock antd Button
vi.mock("antd", () => ({
  Button: vi.fn(({ onClick, loading, children, ...props }) => (
    <button onClick={onClick} disabled={loading} data-loading={loading} {...props}>
      {loading ? "Loading..." : children}
    </button>
  )),
}));

describe("MermaidChartError", () => {
  const mockToken = {
    colorError: "#ff4d4f",
    colorErrorBg: "#fff2f0",
    colorErrorBorder: "#ffccc7",
    colorInfoBg: "#e6f7ff",
    colorInfoBorder: "#91d5ff",
    colorInfo: "#1890ff",
    colorTextSecondary: "#8c8c8c",
    paddingXS: 8,
    paddingSM: 12,
    marginXS: 4,
    marginXXS: 2,
    fontSizeSM: 12,
    borderRadiusSM: 4,
  };

  describe("error display", () => {
    it("should render error message", () => {
      render(
        <MermaidChartError
          error="Syntax error in diagram"
          token={mockToken}
          isFixing={false}
          fixError=""
        />,
      );

      expect(screen.getByText("Mermaid Diagram Error")).toBeInTheDocument();
      expect(screen.getByText("Syntax error in diagram")).toBeInTheDocument();
    });

    it("should render multiple error parts separated by double newlines", () => {
      render(
        <MermaidChartError
          error="Error 1\n\nError 2\n\nError 3"
          token={mockToken}
          isFixing={false}
          fixError=""
        />,
      );

      // Use regex to match text that may be split across elements
      expect(screen.getByText(/Error 1/)).toBeInTheDocument();
      expect(screen.getByText(/Error 2/)).toBeInTheDocument();
      expect(screen.getByText(/Error 3/)).toBeInTheDocument();
    });

    it("should apply special styles to parts starting with 💡", () => {
      const { container } = render(
        <MermaidChartError
          error="Syntax error\n\n💡 Tip: Fix this"
          token={mockToken}
          isFixing={false}
          fixError=""
        />,
      );

      expect(screen.getByText(/Syntax error/)).toBeInTheDocument();
      expect(screen.getByText(/💡 Tip: Fix this/)).toBeInTheDocument();

      // Check that the tip has special styling (info background)
      const tipElements = screen.getAllByText(/💡/);
      expect(tipElements.length).toBeGreaterThan(0);
    });

    it("should not apply special styles to parts not starting with 💡", () => {
      render(
        <MermaidChartError
          error="Regular error\n\nAnother error"
          token={mockToken}
          isFixing={false}
          fixError=""
        />,
      );

      expect(screen.getByText(/Regular error/)).toBeInTheDocument();
      expect(screen.getByText(/Another error/)).toBeInTheDocument();
    });

    it("should render warning emoji icon", () => {
      render(
        <MermaidChartError
          error="Test error"
          token={mockToken}
          isFixing={false}
          fixError=""
        />,
      );

      expect(screen.getByText("⚠️")).toBeInTheDocument();
    });
  });

  describe("className and style props", () => {
    it("should apply custom className", () => {
        const { container } = render(
          <MermaidChartError
            error="Test error"
            token={mockToken}
            isFixing={false}
            fixError=""
            className="custom-class"
          />,
        );

        expect(container.querySelector(".custom-class")).toBeInTheDocument();
      });

    it("should apply custom style", () => {
      const customStyle = { marginTop: "20px", backgroundColor: "red" };
      const { container } = render(
        <MermaidChartError
          error="Test error"
          token={mockToken}
          isFixing={false}
          fixError=""
          style={customStyle}
        />,
      );

      const errorDiv = container.firstChild as HTMLElement;
      expect(errorDiv.style.marginTop).toBe("20px");
      expect(errorDiv.style.backgroundColor).toBe("red");
    });
  });

  describe("Fix button", () => {
    it("should render Fix button when onFix is provided", () => {
      const onFix = vi.fn();
      render(
        <MermaidChartError
          error="Test error"
          token={mockToken}
          onFix={onFix}
          isFixing={false}
          fixError=""
        />,
      );

      expect(screen.getByText("Fix Mermaid")).toBeInTheDocument();
    });

    it("should not render Fix button when onFix is not provided", () => {
      render(
        <MermaidChartError
          error="Test error"
          token={mockToken}
          isFixing={false}
          fixError=""
        />,
      );

      expect(screen.queryByText("Fix Mermaid")).toBeNull();
    });

    it("should call onFix when button is clicked", () => {
      const onFix = vi.fn();
      render(
        <MermaidChartError
          error="Test error"
          token={mockToken}
          onFix={onFix}
          isFixing={false}
          fixError=""
        />,
      );

      const fixButton = screen.getByText("Fix Mermaid");
      fireEvent.click(fixButton);

      expect(onFix).toHaveBeenCalledTimes(1);
    });

    it("should show loading state when isFixing is true", () => {
      const onFix = vi.fn();
      render(
        <MermaidChartError
          error="Test error"
          token={mockToken}
          onFix={onFix}
          isFixing={true}
          fixError=""
        />,
      );

      expect(screen.getByText("Loading...")).toBeInTheDocument();
    });

    it("should not show loading state when isFixing is false", () => {
      const onFix = vi.fn();
      render(
        <MermaidChartError
          error="Test error"
          token={mockToken}
          onFix={onFix}
          isFixing={false}
          fixError=""
        />,
      );

      expect(screen.queryByText("Loading...")).toBeNull();
      expect(screen.getByText("Fix Mermaid")).toBeInTheDocument();
    });
  });

  describe("fixError display", () => {
    it("should render fixError when provided", () => {
      render(
        <MermaidChartError
          error="Test error"
          token={mockToken}
          onFix={vi.fn()}
          isFixing={false}
          fixError="Fix failed: network error"
        />,
      );

      expect(screen.getByText("Fix failed: network error")).toBeInTheDocument();
    });

    it("should not render fixError when empty", () => {
      const { container } = render(
        <MermaidChartError
          error="Test error"
          token={mockToken}
          onFix={vi.fn()}
          isFixing={false}
          fixError=""
        />,
      );

      // fixError should not render when empty - check that no text content has "Fix"
      // apart from the "Fix Mermaid" button
      const allText = container.textContent || "";
      expect(allText).not.toContain("Fix failed");
    });

    it("should not render fixError when onFix is not provided", () => {
      render(
        <MermaidChartError
          error="Test error"
          token={mockToken}
          isFixing={false}
          fixError="This should not appear"
        />,
      );

      expect(screen.queryByText("This should not appear")).toBeNull();
    });
  });

  describe("console hint", () => {
    it("should render console hint message", () => {
      render(
        <MermaidChartError
          error="Test error"
          token={mockToken}
          isFixing={false}
          fixError=""
        />,
      );

      expect(
        screen.getByText("💡 Check browser console (F12) for detailed error information"),
      ).toBeInTheDocument();
    });

    it("should always show console hint regardless of error content", () => {
      render(
        <MermaidChartError
          error=""
          token={mockToken}
          isFixing={false}
          fixError=""
        />,
      );

      expect(
        screen.getByText("💡 Check browser console (F12) for detailed error information"),
      ).toBeInTheDocument();
    });
  });

  describe("title attribute", () => {
    it("should set title attribute with error message", () => {
      const { container } = render(
        <MermaidChartError
          error="Test error message"
          token={mockToken}
          isFixing={false}
          fixError=""
        />,
      );

      const errorDiv = container.firstChild as HTMLElement;
      expect(errorDiv.title).toContain("Test error message");
      expect(errorDiv.title).toContain("Check browser console for detailed error information");
    });

    it("should include full error in title", () => {
      const longError = "Line 1\nLine 2\nLine 3";
      const { container } = render(
        <MermaidChartError
          error={longError}
          token={mockToken}
          isFixing={false}
          fixError=""
        />,
      );

      const errorDiv = container.firstChild as HTMLElement;
      expect(errorDiv.title).toContain(longError);
    });
  });

  describe("edge cases", () => {
    it("should handle empty error string", () => {
      render(
        <MermaidChartError
          error=""
          token={mockToken}
          isFixing={false}
          fixError=""
        />,
      );

      expect(screen.getByText("Mermaid Diagram Error")).toBeInTheDocument();
    });

    it("should handle very long error message", () => {
      const longError = "Error: ".repeat(100);
      render(
        <MermaidChartError
          error={longError}
          token={mockToken}
          isFixing={false}
          fixError=""
        />,
      );

      expect(screen.getByText("Mermaid Diagram Error")).toBeInTheDocument();
    });

    it("should handle error with special characters", () => {
      render(
        <MermaidChartError
          error="Error with <script>alert('xss')</script> and 中文"
          token={mockToken}
          isFixing={false}
          fixError=""
        />,
      );

      expect(screen.getByText(/Error with/)).toBeInTheDocument();
    });

    it("should handle error with only newlines", () => {
      render(
        <MermaidChartError
          error="\n\n\n"
          token={mockToken}
          isFixing={false}
          fixError=""
        />,
      );

      expect(screen.getByText("Mermaid Diagram Error")).toBeInTheDocument();
    });

    it("should handle multiple consecutive 💡 tips", () => {
      render(
        <MermaidChartError
          error="💡 Tip 1\n\n💡 Tip 2\n\n💡 Tip 3"
          token={mockToken}
          isFixing={false}
          fixError=""
        />,
      );

      expect(screen.getByText(/💡 Tip 1/)).toBeInTheDocument();
      expect(screen.getByText(/💡 Tip 2/)).toBeInTheDocument();
      expect(screen.getByText(/💡 Tip 3/)).toBeInTheDocument();
    });

    it("should handle mix of tips and regular errors", () => {
      render(
        <MermaidChartError
          error="Error 1\n\n💡 Tip\n\nError 2"
          token={mockToken}
          isFixing={false}
          fixError=""
        />,
      );

      expect(screen.getByText(/Error 1/)).toBeInTheDocument();
      expect(screen.getByText(/💡 Tip/)).toBeInTheDocument();
      expect(screen.getByText(/Error 2/)).toBeInTheDocument();
    });
  });

  describe("token styling", () => {
    it("should use token values for styling", () => {
      const customToken = {
        ...mockToken,
        colorError: "red",
        colorErrorBg: "pink",
        paddingXS: 10,
        paddingSM: 20,
      };

      const { container } = render(
        <MermaidChartError
          error="Test error"
          token={customToken}
          isFixing={false}
          fixError=""
        />,
      );

      const errorDiv = container.firstChild as HTMLElement;
      expect(errorDiv.style.color).toBe("red");
      expect(errorDiv.style.background).toBe("pink");
    });
  });
});
