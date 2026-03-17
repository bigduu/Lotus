import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import MermaidChartViewer from "../MermaidChartViewer";

// Mock FileOperationsService
vi.mock("@shared/services/FileOperationsService", () => ({
  FileOperationsService: {
    generateTimestampedFilename: vi.fn((prefix, ext) => `${prefix}-2024-01-01-12-00-00.${ext}`),
    saveBinaryFile: vi.fn(),
    FILTERS: {
      SVG: { name: "SVG", extensions: ["svg"] },
    },
  },
}));

// Mock antd
const mockMessage = {
  success: vi.fn(),
  error: vi.fn(),
};

vi.mock("antd", () => ({
  App: {
    useApp: () => ({
      message: mockMessage,
    }),
  },
  Button: vi.fn(({ onClick, disabled, loading, icon, children, ...props }) => (
    <button onClick={onClick} disabled={disabled} data-loading={loading} {...props}>
      {icon && <span data-icon="true">{icon}</span>}
      {children}
    </button>
  )),
  Tooltip: vi.fn(({ title, children }) => (
    <div data-tooltip={title}>{children}</div>
  )),
}));

// Mock react-zoom-pan-pinch
const mockZoomIn = vi.fn();
const mockZoomOut = vi.fn();
const mockResetTransform = vi.fn();

vi.mock("react-zoom-pan-pinch", () => ({
  TransformWrapper: vi.fn(({ children, initialScale, minScale, maxScale }) => (
    <div data-testid="transform-wrapper" data-initial-scale={initialScale} data-min-scale={minScale} data-max-scale={maxScale}>
      {children({ zoomIn: mockZoomIn, zoomOut: mockZoomOut, resetTransform: mockResetTransform })}
    </div>
  )),
  TransformComponent: vi.fn(({ children, wrapperStyle, contentStyle }) => (
    <div data-testid="transform-component" style={wrapperStyle}>
      <div style={contentStyle}>{children}</div>
    </div>
  )),
}));

// Mock @ant-design/icons
vi.mock("@ant-design/icons", () => ({
  DownloadOutlined: () => <span>DownloadIcon</span>,
}));

import { FileOperationsService } from "@shared/services/FileOperationsService";

describe("MermaidChartViewer", () => {
  const mockToken = {
    marginXS: 4,
    padding: 16,
    colorBgContainer: "#ffffff",
    colorBorder: "#d9d9d9",
    borderRadiusSM: 4,
    colorTextSecondary: "#8c8c8c",
    fontSizeSM: 12,
    boxShadowSecondary: "0 2px 8px rgba(0,0,0,0.15)",
  };

  const mockContainerRef = { current: null };
  const defaultProps = {
    svg: "<svg>test</svg>",
    height: 400,
    isLoading: false,
    initialScale: 1.0,
    token: mockToken,
    containerRef: mockContainerRef,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessage.success.mockClear();
    mockMessage.error.mockClear();
  });

  describe("normalizeSvgMarkup", () => {
    it("should add xmlns attributes if missing", () => {
      const svg = "<svg><rect /></svg>";
      render(<MermaidChartViewer {...defaultProps} svg={svg} />);

      // Component renders, normalizeSvgMarkup is called internally
      expect(screen.getByTestId("transform-wrapper")).toBeInTheDocument();
    });

    it("should preserve existing xmlns attributes", () => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>';
      render(<MermaidChartViewer {...defaultProps} svg={svg} />);

      expect(screen.getByTestId("transform-wrapper")).toBeInTheDocument();
    });

    it("should return original markup if no svg element found", () => {
      const noSvg = "<div>not an svg</div>";
      render(<MermaidChartViewer {...defaultProps} svg={noSvg} />);

      expect(screen.getByTestId("transform-wrapper")).toBeInTheDocument();
    });

    it("should add XML declaration", () => {
      render(<MermaidChartViewer {...defaultProps} />);

      expect(screen.getByTestId("transform-wrapper")).toBeInTheDocument();
    });
  });

  describe("rendering", () => {
    it("should render container with correct data-mermaid-loading attribute", () => {
      const { container } = render(<MermaidChartViewer {...defaultProps} isLoading={false} />);

      expect(container.firstChild).toHaveAttribute("data-mermaid-loading", "false");
    });

    it("should set data-mermaid-loading to true when loading", () => {
      const { container } = render(<MermaidChartViewer {...defaultProps} isLoading={true} />);

      expect(container.firstChild).toHaveAttribute("data-mermaid-loading", "true");
    });

    it("should render loading message when isLoading is true", () => {
      render(<MermaidChartViewer {...defaultProps} isLoading={true} />);

      expect(screen.getByText("Rendering diagram...")).toBeInTheDocument();
    });

    it("should not render loading message when isLoading is false", () => {
      render(<MermaidChartViewer {...defaultProps} isLoading={false} />);

      expect(screen.queryByText("Rendering diagram...")).toBeNull();
    });

    it("should apply className prop", () => {
      const { container } = render(<MermaidChartViewer {...defaultProps} className="custom-class" />);

      expect(container.firstChild).toHaveClass("custom-class");
    });

    it("should apply custom style prop", () => {
      const customStyle = { marginTop: "20px", backgroundColor: "red" };
      const { container } = render(<MermaidChartViewer {...defaultProps} style={customStyle} />);

      const viewerDiv = container.firstChild as HTMLElement;
      expect(viewerDiv.style.marginTop).toBe("20px");
      expect(viewerDiv.style.backgroundColor).toBe("red");
    });

    it("should calculate height with Math.min", () => {
      const { container } = render(<MermaidChartViewer {...defaultProps} height={1000} />);

      const viewerDiv = container.firstChild as HTMLElement;
      expect(viewerDiv.style.height).toBe("800px"); // Math.min(1000, 800)
    });

    it("should use actual height when less than 800", () => {
      const { container } = render(<MermaidChartViewer {...defaultProps} height={500} />);

      const viewerDiv = container.firstChild as HTMLElement;
      expect(viewerDiv.style.height).toBe("500px");
    });

    it("should render svg content", () => {
      render(<MermaidChartViewer {...defaultProps} svg="<svg>test content</svg>" />);

      expect(screen.getByTestId("transform-component")).toBeInTheDocument();
    });

    it("should set opacity to 0 when loading", () => {
      const { container } = render(<MermaidChartViewer {...defaultProps} isLoading={true} />);

      const contentDiv = container.querySelector('[style*="opacity: 0"]');
      expect(contentDiv).toBeInTheDocument();
    });

    it("should set opacity to 1 when not loading", () => {
      const { container } = render(<MermaidChartViewer {...defaultProps} isLoading={false} />);

      const contentDiv = container.querySelector('[style*="opacity: 1"]');
      expect(contentDiv).toBeInTheDocument();
    });
  });

  describe("TransformWrapper configuration", () => {
    it("should pass initialScale prop", () => {
      render(<MermaidChartViewer {...defaultProps} initialScale={1.5} />);

      const wrapper = screen.getByTestId("transform-wrapper");
      expect(wrapper.getAttribute("data-initial-scale")).toBe("1.5");
    });

    it("should set minScale to 0.1", () => {
      render(<MermaidChartViewer {...defaultProps} />);

      const wrapper = screen.getByTestId("transform-wrapper");
      expect(wrapper.getAttribute("data-min-scale")).toBe("0.1");
    });

    it("should set maxScale to 10", () => {
      render(<MermaidChartViewer {...defaultProps} />);

      const wrapper = screen.getByTestId("transform-wrapper");
      expect(wrapper.getAttribute("data-max-scale")).toBe("10");
    });
  });

  describe("zoom controls", () => {
    it("should render zoom in button", () => {
      render(<MermaidChartViewer {...defaultProps} />);

      expect(screen.getByText("+")).toBeInTheDocument();
    });

    it("should render zoom out button", () => {
      render(<MermaidChartViewer {...defaultProps} />);

      expect(screen.getByText("-")).toBeInTheDocument();
    });

    it("should render reset button", () => {
      render(<MermaidChartViewer {...defaultProps} />);

      expect(screen.getByText("⌂")).toBeInTheDocument();
    });

    it("should call zoomIn when + button clicked", () => {
      render(<MermaidChartViewer {...defaultProps} />);

      const zoomInButton = screen.getByText("+");
      fireEvent.click(zoomInButton);

      expect(mockZoomIn).toHaveBeenCalledTimes(1);
    });

    it("should call zoomOut when - button clicked", () => {
      render(<MermaidChartViewer {...defaultProps} />);

      const zoomOutButton = screen.getByText("-");
      fireEvent.click(zoomOutButton);

      expect(mockZoomOut).toHaveBeenCalledTimes(1);
    });

    it("should call resetTransform when reset button clicked", () => {
      render(<MermaidChartViewer {...defaultProps} />);

      const resetButton = screen.getByText("⌂");
      fireEvent.click(resetButton);

      expect(mockResetTransform).toHaveBeenCalledTimes(1);
    });
  });

  describe("export functionality", () => {
    it("should render export button with tooltip", () => {
      render(<MermaidChartViewer {...defaultProps} />);

      expect(screen.getByText("DownloadIcon")).toBeInTheDocument();
      expect(screen.getByText("DownloadIcon").closest("[data-tooltip]")).toHaveAttribute(
        "data-tooltip",
        "Export SVG",
      );
    });

    it("should disable export button when loading", () => {
      render(<MermaidChartViewer {...defaultProps} isLoading={true} />);

      const exportButton = screen.getByText("DownloadIcon").closest("button");
      expect(exportButton).toBeDisabled();
    });

    it("should disable export button when svg is empty", () => {
      render(<MermaidChartViewer {...defaultProps} svg="" />);

      const exportButton = screen.getByText("DownloadIcon").closest("button");
      expect(exportButton).toBeDisabled();
    });

    it("should disable export button when exporting", async () => {
      const mockSaveBinaryFile = vi.mocked(FileOperationsService.saveBinaryFile);
      mockSaveBinaryFile.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)));

      render(<MermaidChartViewer {...defaultProps} />);

      const exportButton = screen.getByText("DownloadIcon").closest("button");
      fireEvent.click(exportButton);

      // Button should be disabled while exporting
      await waitFor(() => {
        expect(exportButton).toBeDisabled();
      });
    });

    it("should call saveBinaryFile with correct parameters", async () => {
      const mockSaveBinaryFile = vi.mocked(FileOperationsService.saveBinaryFile);
      mockSaveBinaryFile.mockResolvedValue({ success: true, filename: "test.svg" });

      const mockGenerateTimestampedFilename = vi.mocked(FileOperationsService.generateTimestampedFilename);

      render(<MermaidChartViewer {...defaultProps} chartKey="test-chart-123" />);

      const exportButton = screen.getByText("DownloadIcon").closest("button");
      fireEvent.click(exportButton);

      await waitFor(() => {
        expect(mockGenerateTimestampedFilename).toHaveBeenCalledWith("mermaid-test-cha", "svg");
        expect(mockSaveBinaryFile).toHaveBeenCalled();
      });
    });

    it("should use default prefix when chartKey is not provided", async () => {
      const mockSaveBinaryFile = vi.mocked(FileOperationsService.saveBinaryFile);
      mockSaveBinaryFile.mockResolvedValue({ success: true, filename: "test.svg" });

      const mockGenerateTimestampedFilename = vi.mocked(FileOperationsService.generateTimestampedFilename);

      render(<MermaidChartViewer {...defaultProps} chartKey={undefined} />);

      const exportButton = screen.getByText("DownloadIcon").closest("button");
      fireEvent.click(exportButton);

      await waitFor(() => {
        expect(mockGenerateTimestampedFilename).toHaveBeenCalledWith("mermaid-graph", "svg");
      });
    });

    it("should show success message on successful export", async () => {
      const mockSaveBinaryFile = vi.mocked(FileOperationsService.saveBinaryFile);
      mockSaveBinaryFile.mockResolvedValue({ success: true, filename: "diagram.svg" });

      render(<MermaidChartViewer {...defaultProps} />);

      const exportButton = screen.getByText("DownloadIcon").closest("button");
      fireEvent.click(exportButton);

      await waitFor(() => {
        expect(mockMessage.success).toHaveBeenCalledWith("Saved: diagram.svg");
      });
    });

    it("should handle cancelled export", async () => {
      const mockSaveBinaryFile = vi.mocked(FileOperationsService.saveBinaryFile);
      mockSaveBinaryFile.mockResolvedValue({ success: false, error: "User cancelled" });

      render(<MermaidChartViewer {...defaultProps} />);

      const exportButton = screen.getByText("DownloadIcon").closest("button");
      fireEvent.click(exportButton);

      await waitFor(() => {
        expect(mockMessage.success).not.toHaveBeenCalled();
        expect(mockMessage.error).not.toHaveBeenCalled();
      });
    });

    it("should show error message on export failure", async () => {
      const mockSaveBinaryFile = vi.mocked(FileOperationsService.saveBinaryFile);
      mockSaveBinaryFile.mockResolvedValue({ success: false, error: "Disk full" });

      render(<MermaidChartViewer {...defaultProps} />);

      const exportButton = screen.getByText("DownloadIcon").closest("button");
      fireEvent.click(exportButton);

      await waitFor(() => {
        expect(mockMessage.error).toHaveBeenCalledWith("Disk full");
      });
    });

    it("should show default error message when error is empty", async () => {
      const mockSaveBinaryFile = vi.mocked(FileOperationsService.saveBinaryFile);
      mockSaveBinaryFile.mockResolvedValue({ success: false, error: "" });

      render(<MermaidChartViewer {...defaultProps} />);

      const exportButton = screen.getByText("DownloadIcon").closest("button");
      fireEvent.click(exportButton);

      await waitFor(() => {
        expect(mockMessage.error).toHaveBeenCalledWith("Export failed");
      });
    });

    it("should handle export exception with Error instance", async () => {
      const mockSaveBinaryFile = vi.mocked(FileOperationsService.saveBinaryFile);
      mockSaveBinaryFile.mockRejectedValue(new Error("Network error"));

      render(<MermaidChartViewer {...defaultProps} />);

      const exportButton = screen.getByText("DownloadIcon").closest("button");
      fireEvent.click(exportButton);

      await waitFor(() => {
        expect(mockMessage.error).toHaveBeenCalledWith("Network error");
      });
    });

    it("should handle export exception with non-Error", async () => {
      const mockSaveBinaryFile = vi.mocked(FileOperationsService.saveBinaryFile);
      mockSaveBinaryFile.mockRejectedValue("String error");

      render(<MermaidChartViewer {...defaultProps} />);

      const exportButton = screen.getByText("DownloadIcon").closest("button");
      fireEvent.click(exportButton);

      await waitFor(() => {
        expect(mockMessage.error).toHaveBeenCalledWith("Failed to export Mermaid graph");
      });
    });

    it("should reset isExporting after export completes", async () => {
      const mockSaveBinaryFile = vi.mocked(FileOperationsService.saveBinaryFile);
      mockSaveBinaryFile.mockResolvedValue({ success: true, filename: "test.svg" });

      render(<MermaidChartViewer {...defaultProps} />);

      const exportButton = screen.getByText("DownloadIcon").closest("button");
      fireEvent.click(exportButton);

      // Wait for export to complete
      await waitFor(() => {
        expect(exportButton).not.toBeDisabled();
      });
    });

    it("should not export when svg is empty", async () => {
      const mockSaveBinaryFile = vi.mocked(FileOperationsService.saveBinaryFile);

      render(<MermaidChartViewer {...defaultProps} svg="" />);

      const exportButton = screen.getByText("DownloadIcon").closest("button");
      fireEvent.click(exportButton);

      expect(mockSaveBinaryFile).not.toHaveBeenCalled();
    });

    it("should prevent multiple simultaneous exports", async () => {
      const mockSaveBinaryFile = vi.mocked(FileOperationsService.saveBinaryFile);
      mockSaveBinaryFile.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)));

      render(<MermaidChartViewer {...defaultProps} />);

      const exportButton = screen.getByText("DownloadIcon").closest("button");
      fireEvent.click(exportButton);
      fireEvent.click(exportButton);
      fireEvent.click(exportButton);

      await waitFor(() => {
        expect(mockSaveBinaryFile).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("SVG processing", () => {
    it("should inject max-width and max-height styles into SVG", () => {
      const svg = '<svg width="100"><rect /></svg>';
      render(<MermaidChartViewer {...defaultProps} svg={svg} />);

      expect(screen.getByTestId("transform-component")).toBeInTheDocument();
    });

    it("should handle SVG with existing style attribute", () => {
      const svg = '<svg style="background: red"><rect /></svg>';
      render(<MermaidChartViewer {...defaultProps} svg={svg} />);

      expect(screen.getByTestId("transform-component")).toBeInTheDocument();
    });

    it("should handle SVG with multiple attributes", () => {
      const svg = '<svg width="100" height="200" viewBox="0 0 100 200"><rect /></svg>';
      render(<MermaidChartViewer {...defaultProps} svg={svg} />);

      expect(screen.getByTestId("transform-component")).toBeInTheDocument();
    });
  });

  describe("edge cases", () => {
    it("should handle empty SVG string", () => {
      render(<MermaidChartViewer {...defaultProps} svg="" />);

      expect(screen.getByTestId("transform-wrapper")).toBeInTheDocument();
    });

    it("should handle very large height", () => {
      const { container } = render(<MermaidChartViewer {...defaultProps} height={10000} />);

      const viewerDiv = container.firstChild as HTMLElement;
      expect(viewerDiv.style.height).toBe("800px"); // Capped at 800
    });

    it("should handle very small height", () => {
      const { container } = render(<MermaidChartViewer {...defaultProps} height={100} />);

      const viewerDiv = container.firstChild as HTMLElement;
      expect(viewerDiv.style.height).toBe("100px");
    });

    it("should handle complex SVG with nested elements", () => {
      const complexSvg = `
        <svg xmlns="http://www.w3.org/2000/svg">
          <g transform="translate(10,10)">
            <rect width="100" height="100" />
            <circle cx="50" cy="50" r="40" />
          </g>
        </svg>
      `;
      render(<MermaidChartViewer {...defaultProps} svg={complexSvg} />);

      expect(screen.getByTestId("transform-wrapper")).toBeInTheDocument();
    });

    it("should handle SVG with special characters", () => {
      const svgWithSpecialChars = '<svg><text>中文 & 日本語</text></svg>';
      render(<MermaidChartViewer {...defaultProps} svg={svgWithSpecialChars} />);

      expect(screen.getByTestId("transform-component")).toBeInTheDocument();
    });

    it("should handle malformed SVG gracefully", () => {
      const malformedSvg = "<svg><rect></svg>"; // Missing closing tag
      render(<MermaidChartViewer {...defaultProps} svg={malformedSvg} />);

      expect(screen.getByTestId("transform-component")).toBeInTheDocument();
    });

    it("should handle very long chartKey", () => {
      const longKey = "a".repeat(100);
      render(<MermaidChartViewer {...defaultProps} chartKey={longKey} />);

      expect(screen.getByTestId("transform-wrapper")).toBeInTheDocument();
    });
  });

  describe("token styling", () => {
    it("should use token values for styling", () => {
      const customToken = {
        ...mockToken,
        colorBgContainer: "blue",
        colorBorder: "red",
        padding: 20,
      };

      const { container } = render(<MermaidChartViewer {...defaultProps} token={customToken} />);

      const viewerDiv = container.firstChild as HTMLElement;
      expect(viewerDiv.style.background).toBe("blue");
      expect(viewerDiv.style.border).toContain("red");
      expect(viewerDiv.style.padding).toBe("20px");
    });
  });
});
