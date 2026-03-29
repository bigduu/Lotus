import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { MermaidChart } from "../index";

// Mock antd theme
vi.mock("antd", () => ({
  theme: {
    useToken: () => ({
      token: {
        colorError: "#ff4d4f",
        colorErrorBg: "#fff2f0",
        colorErrorBorder: "#ffccc7",
        colorBgContainer: "#ffffff",
        colorBorder: "#d9d9d9",
        marginXS: 4,
        marginXXS: 2,
        paddingXS: 8,
        paddingSM: 12,
        padding: 16,
        fontSizeSM: 12,
        borderRadiusSM: 4,
      },
    }),
  },
}));

// Mock mermaid settings store
vi.mock("../../../store/mermaidSettingsStore", () => ({
  useMermaidSettings: () => ({
    theme: "default" as const,
    themeVariables: {},
    fontSize: 16,
    defaultScale: 1.0,
    useMaxWidth: true,
    flowchartNodeSpacing: 50,
    flowchartRankSpacing: 50,
    flowchartCurve: "basis" as const,
    sequenceActorMargin: 50,
    sequenceMessageMargin: 35,
    sequenceWidth: 150,
    sequenceHeight: 65,
    ganttBarHeight: 20,
    ganttTopPadding: 50,
  }),
}));

// Mock useMermaidRenderState hook
vi.mock("../useMermaidRenderState", () => ({
  useMermaidRenderState: vi.fn(),
}));

// Mock MermaidChartError component
vi.mock("../MermaidChartError", () => ({
  default: vi.fn(({ error, onFix, isFixing, fixError }) => (
    <div data-testid="mermaid-error">
      <div data-error-message>{error}</div>
      {onFix && (
        <button data-testid="fix-button" onClick={onFix} disabled={isFixing}>
          Fix
        </button>
      )}
      {fixError && <div data-fix-error>{fixError}</div>}
    </div>
  )),
}));

// Mock MermaidChartViewer component
vi.mock("../MermaidChartViewer", () => ({
  default: vi.fn(({ svg, isLoading, initialScale, chartKey }) => (
    <div data-testid="mermaid-viewer" data-scale={initialScale} data-chart-key={chartKey}>
      {isLoading && <div data-testid="loading">Loading...</div>}
      <div dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  )),
}));

import { useMermaidRenderState } from "../useMermaidRenderState";
import MermaidChartError from "../MermaidChartError";
import MermaidChartViewer from "../MermaidChartViewer";

describe("MermaidChart", () => {
  const mockUseMermaidRenderState = useMermaidRenderState as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("rendering paths", () => {
    it("should render MermaidChartError when error is present", () => {
      mockUseMermaidRenderState.mockReturnValue({
        renderState: {
          svg: "",
          height: 200,
          svgWidth: 800,
          svgHeight: 200,
          error: "Syntax error in mermaid diagram",
          isLoading: false,
        },
        chartKey: "test-key",
      });

      render(<MermaidChart chart="graph TD\n  A --> B" />);

      expect(screen.getByTestId("mermaid-error")).toBeInTheDocument();
      expect(
        screen.getByTestId("mermaid-error").querySelector("[data-error-message]")?.textContent,
      ).toBe("Syntax error in mermaid diagram");
    });

    it("should render MermaidChartViewer when no error", () => {
      mockUseMermaidRenderState.mockReturnValue({
        renderState: {
          svg: "<svg>test</svg>",
          height: 400,
          svgWidth: 800,
          svgHeight: 200,
          error: "",
          isLoading: false,
        },
        chartKey: "test-key",
      });

      render(<MermaidChart chart="graph TD\n  A --> B" />);

      expect(screen.getByTestId("mermaid-viewer")).toBeInTheDocument();
      expect(screen.queryByTestId("mermaid-error")).toBeNull();
    });

    it("should render loading state in MermaidChartViewer", () => {
      mockUseMermaidRenderState.mockReturnValue({
        renderState: {
          svg: "",
          height: 200,
          svgWidth: 800,
          svgHeight: 200,
          error: "",
          isLoading: true,
        },
        chartKey: "test-key",
      });

      render(<MermaidChart chart="graph TD\n  A --> B" />);

      expect(screen.getByTestId("mermaid-viewer")).toBeInTheDocument();
      expect(screen.getByTestId("loading")).toBeInTheDocument();
    });
  });

  describe("scale calculation", () => {
    it("should calculate scale * 0.8 for svgWidth > 1200", () => {
      mockUseMermaidRenderState.mockReturnValue({
        renderState: {
          svg: "<svg>test</svg>",
          height: 400,
          svgWidth: 1500,
          svgHeight: 200,
          error: "",
          isLoading: false,
        },
        chartKey: "test-key",
      });

      render(<MermaidChart chart="graph TD\n  A --> B" />);

      const viewer = screen.getByTestId("mermaid-viewer");
      expect(viewer.getAttribute("data-scale")).toBe("0.8"); // 1.0 * 0.8
    });

    it("should calculate scale * 1.0 for svgWidth > 800", () => {
      mockUseMermaidRenderState.mockReturnValue({
        renderState: {
          svg: "<svg>test</svg>",
          height: 400,
          svgWidth: 1000,
          svgHeight: 200,
          error: "",
          isLoading: false,
        },
        chartKey: "test-key",
      });

      render(<MermaidChart chart="graph TD\n  A --> B" />);

      const viewer = screen.getByTestId("mermaid-viewer");
      expect(viewer.getAttribute("data-scale")).toBe("1"); // 1.0 * 1.0
    });

    it("should calculate scale * 1.2 for svgWidth <= 800", () => {
      mockUseMermaidRenderState.mockReturnValue({
        renderState: {
          svg: "<svg>test</svg>",
          height: 400,
          svgWidth: 600,
          svgHeight: 200,
          error: "",
          isLoading: false,
        },
        chartKey: "test-key",
      });

      render(<MermaidChart chart="graph TD\n  A --> B" />);

      const viewer = screen.getByTestId("mermaid-viewer");
      expect(viewer.getAttribute("data-scale")).toBe("1.2"); // 1.0 * 1.2
    });

    it("should calculate scale * 1.2 for svgWidth exactly 800", () => {
      mockUseMermaidRenderState.mockReturnValue({
        renderState: {
          svg: "<svg>test</svg>",
          height: 400,
          svgWidth: 800,
          svgHeight: 200,
          error: "",
          isLoading: false,
        },
        chartKey: "test-key",
      });

      render(<MermaidChart chart="graph TD\n  A --> B" />);

      const viewer = screen.getByTestId("mermaid-viewer");
      // svgWidth exactly 800 does not satisfy > 800, so falls to the default case
      expect(viewer.getAttribute("data-scale")).toBe("1.2"); // 1.0 * 1.2
    });

    it("should calculate scale * 1.0 for svgWidth exactly 1200", () => {
      mockUseMermaidRenderState.mockReturnValue({
        renderState: {
          svg: "<svg>test</svg>",
          height: 400,
          svgWidth: 1200,
          svgHeight: 200,
          error: "",
          isLoading: false,
        },
        chartKey: "test-key",
      });

      render(<MermaidChart chart="graph TD\n  A --> B" />);

      const viewer = screen.getByTestId("mermaid-viewer");
      expect(viewer.getAttribute("data-scale")).toBe("1"); // 1.0 * 1.0 (not 0.8)
    });
  });

  describe("handleFix functionality", () => {
    it("should pass handleFix to MermaidChartError when onFix prop is provided", () => {
      const onFix = vi.fn();
      mockUseMermaidRenderState.mockReturnValue({
        renderState: {
          svg: "",
          height: 200,
          svgWidth: 800,
          svgHeight: 200,
          error: "Syntax error",
          isLoading: false,
        },
        chartKey: "test-key",
      });

      render(<MermaidChart chart="graph TD\n  A --> B" onFix={onFix} />);

      expect(screen.getByTestId("fix-button")).toBeInTheDocument();
    });

    it("should not pass handleFix to MermaidChartError when onFix is undefined", () => {
      mockUseMermaidRenderState.mockReturnValue({
        renderState: {
          svg: "",
          height: 200,
          svgWidth: 800,
          svgHeight: 200,
          error: "Syntax error",
          isLoading: false,
        },
        chartKey: "test-key",
      });

      render(<MermaidChart chart="graph TD\n  A --> B" />);

      expect(screen.queryByTestId("fix-button")).toBeNull();
    });

    it("should call onFix when fix button is clicked", async () => {
      const onFix = vi.fn().mockResolvedValue(undefined);
      mockUseMermaidRenderState.mockReturnValue({
        renderState: {
          svg: "",
          height: 200,
          svgWidth: 800,
          svgHeight: 200,
          error: "Syntax error",
          isLoading: false,
        },
        chartKey: "test-key",
      });

      const chartString = "graph TD\n  A --> B";
      render(<MermaidChart chart={chartString} onFix={onFix} />);

      const fixButton = screen.getByTestId("fix-button");
      fireEvent.click(fixButton);

      await waitFor(() => {
        expect(onFix).toHaveBeenCalledWith(chartString, "Syntax error");
      });
    });

    it("should handle onFix error and display error message", async () => {
      const onFix = vi.fn().mockRejectedValue(new Error("Fix failed"));
      mockUseMermaidRenderState.mockReturnValue({
        renderState: {
          svg: "",
          height: 200,
          svgWidth: 800,
          svgHeight: 200,
          error: "Syntax error",
          isLoading: false,
        },
        chartKey: "test-key",
      });

      render(<MermaidChart chart="graph TD\n  A --> B" onFix={onFix} />);

      const fixButton = screen.getByTestId("fix-button");
      fireEvent.click(fixButton);

      await waitFor(() => {
        expect(
          screen.getByTestId("mermaid-error").querySelector("[data-fix-error]")?.textContent,
        ).toBe("Fix failed");
      });
    });

    it("should handle non-Error onFix rejection", async () => {
      const onFix = vi.fn().mockRejectedValue("String error");
      mockUseMermaidRenderState.mockReturnValue({
        renderState: {
          svg: "",
          height: 200,
          svgWidth: 800,
          svgHeight: 200,
          error: "Syntax error",
          isLoading: false,
        },
        chartKey: "test-key",
      });

      render(<MermaidChart chart="graph TD\n  A --> B" onFix={onFix} />);

      const fixButton = screen.getByTestId("fix-button");
      fireEvent.click(fixButton);

      await waitFor(() => {
        expect(
          screen.getByTestId("mermaid-error").querySelector("[data-fix-error]")?.textContent,
        ).toBe("String error");
      });
    });

    it("should display default error message when error message is empty", async () => {
      const onFix = vi.fn().mockRejectedValue(new Error(""));
      mockUseMermaidRenderState.mockReturnValue({
        renderState: {
          svg: "",
          height: 200,
          svgWidth: 800,
          svgHeight: 200,
          error: "Syntax error",
          isLoading: false,
        },
        chartKey: "test-key",
      });

      render(<MermaidChart chart="graph TD\n  A --> B" onFix={onFix} />);

      const fixButton = screen.getByTestId("fix-button");
      fireEvent.click(fixButton);

      await waitFor(() => {
        expect(
          screen.getByTestId("mermaid-error").querySelector("[data-fix-error]")?.textContent,
        ).toBe("Failed to fix Mermaid diagram");
      });
    });

    it("should prevent multiple simultaneous fix calls", async () => {
      const onFix = vi
        .fn()
        .mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)));
      mockUseMermaidRenderState.mockReturnValue({
        renderState: {
          svg: "",
          height: 200,
          svgWidth: 800,
          svgHeight: 200,
          error: "Syntax error",
          isLoading: false,
        },
        chartKey: "test-key",
      });

      render(<MermaidChart chart="graph TD\n  A --> B" onFix={onFix} />);

      const fixButton = screen.getByTestId("fix-button");

      // Click multiple times rapidly
      fireEvent.click(fixButton);
      fireEvent.click(fixButton);
      fireEvent.click(fixButton);

      await waitFor(() => {
        // Should only be called once due to isFixing guard
        expect(onFix).toHaveBeenCalledTimes(1);
      });
    });

    it("should disable fix button while fixing", async () => {
      const onFix = vi
        .fn()
        .mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)));
      mockUseMermaidRenderState.mockReturnValue({
        renderState: {
          svg: "",
          height: 200,
          svgWidth: 800,
          svgHeight: 200,
          error: "Syntax error",
          isLoading: false,
        },
        chartKey: "test-key",
      });

      render(<MermaidChart chart="graph TD\n  A --> B" onFix={onFix} />);

      const fixButton = screen.getByTestId("fix-button") as HTMLButtonElement;
      expect(fixButton.disabled).toBe(false);

      fireEvent.click(fixButton);

      // Button should be disabled while fixing
      await waitFor(() => {
        expect(fixButton.disabled).toBe(true);
      });

      // Wait for fix to complete
      await waitFor(
        () => {
          expect(fixButton.disabled).toBe(false);
        },
        { timeout: 200 },
      );
    });
  });

  describe("props handling", () => {
    it("should pass className to MermaidChartError", () => {
      mockUseMermaidRenderState.mockReturnValue({
        renderState: {
          svg: "",
          height: 200,
          svgWidth: 800,
          svgHeight: 200,
          error: "Syntax error",
          isLoading: false,
        },
        chartKey: "test-key",
      });

      render(<MermaidChart chart="graph TD\n  A --> B" className="custom-class" />);

      expect(MermaidChartError).toHaveBeenCalledWith(
        expect.objectContaining({
          className: "custom-class",
        }),
        expect.anything(),
      );
    });

    it("should pass className to MermaidChartViewer", () => {
      mockUseMermaidRenderState.mockReturnValue({
        renderState: {
          svg: "<svg>test</svg>",
          height: 400,
          svgWidth: 800,
          svgHeight: 200,
          error: "",
          isLoading: false,
        },
        chartKey: "test-key",
      });

      render(<MermaidChart chart="graph TD\n  A --> B" className="custom-class" />);

      expect(MermaidChartViewer).toHaveBeenCalledWith(
        expect.objectContaining({
          className: "custom-class",
        }),
        expect.anything(),
      );
    });

    it("should pass style to MermaidChartError", () => {
      mockUseMermaidRenderState.mockReturnValue({
        renderState: {
          svg: "",
          height: 200,
          svgWidth: 800,
          svgHeight: 200,
          error: "Syntax error",
          isLoading: false,
        },
        chartKey: "test-key",
      });

      const customStyle = { marginTop: "20px" };
      render(<MermaidChart chart="graph TD\n  A --> B" style={customStyle} />);

      expect(MermaidChartError).toHaveBeenCalledWith(
        expect.objectContaining({
          style: customStyle,
        }),
        expect.anything(),
      );
    });

    it("should pass style to MermaidChartViewer", () => {
      mockUseMermaidRenderState.mockReturnValue({
        renderState: {
          svg: "<svg>test</svg>",
          height: 400,
          svgWidth: 800,
          svgHeight: 200,
          error: "",
          isLoading: false,
        },
        chartKey: "test-key",
      });

      const customStyle = { marginTop: "20px" };
      render(<MermaidChart chart="graph TD\n  A --> B" style={customStyle} />);

      expect(MermaidChartViewer).toHaveBeenCalledWith(
        expect.objectContaining({
          style: customStyle,
        }),
        expect.anything(),
      );
    });

    it("should pass chartKey to MermaidChartViewer", () => {
      mockUseMermaidRenderState.mockReturnValue({
        renderState: {
          svg: "<svg>test</svg>",
          height: 400,
          svgWidth: 800,
          svgHeight: 200,
          error: "",
          isLoading: false,
        },
        chartKey: "unique-chart-key",
      });

      render(<MermaidChart chart="graph TD\n  A --> B" />);

      const viewer = screen.getByTestId("mermaid-viewer");
      expect(viewer.getAttribute("data-chart-key")).toBe("unique-chart-key");
    });
  });

  describe("edge cases", () => {
    it("should handle empty chart string", () => {
      mockUseMermaidRenderState.mockReturnValue({
        renderState: {
          svg: "",
          height: 200,
          svgWidth: 800,
          svgHeight: 200,
          error: "",
          isLoading: false,
        },
        chartKey: "empty-key",
      });

      render(<MermaidChart chart="" />);

      expect(screen.getByTestId("mermaid-viewer")).toBeInTheDocument();
    });

    it("should handle very large svgWidth", () => {
      mockUseMermaidRenderState.mockReturnValue({
        renderState: {
          svg: "<svg>test</svg>",
          height: 400,
          svgWidth: 5000,
          svgHeight: 200,
          error: "",
          isLoading: false,
        },
        chartKey: "test-key",
      });

      render(<MermaidChart chart="graph TD\n  A --> B" />);

      const viewer = screen.getByTestId("mermaid-viewer");
      expect(viewer.getAttribute("data-scale")).toBe("0.8"); // 1.0 * 0.8
    });

    it("should handle very small svgWidth", () => {
      mockUseMermaidRenderState.mockReturnValue({
        renderState: {
          svg: "<svg>test</svg>",
          height: 400,
          svgWidth: 100,
          svgHeight: 200,
          error: "",
          isLoading: false,
        },
        chartKey: "test-key",
      });

      render(<MermaidChart chart="graph TD\n  A --> B" />);

      const viewer = screen.getByTestId("mermaid-viewer");
      expect(viewer.getAttribute("data-scale")).toBe("1.2"); // 1.0 * 1.2
    });

    it("should handle multiline error messages", () => {
      mockUseMermaidRenderState.mockReturnValue({
        renderState: {
          svg: "",
          height: 200,
          svgWidth: 800,
          svgHeight: 200,
          error: "Line 1 error\nLine 2 error\nLine 3 error",
          isLoading: false,
        },
        chartKey: "test-key",
      });

      render(<MermaidChart chart="graph TD\n  A --> B" />);

      expect(screen.getByTestId("mermaid-error")).toBeInTheDocument();
    });
  });
});
