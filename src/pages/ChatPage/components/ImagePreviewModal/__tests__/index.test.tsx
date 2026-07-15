import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ImagePreviewModal } from "../index";
import type { ImageFile } from "../../../utils/imageUtils";

// Mock formatFileSize
vi.mock("../../../utils/imageUtils", () => ({
  formatFileSize: vi.fn((size: number) => `${size} bytes`),
}));

describe("ImagePreviewModal", () => {
  const mockImages: ImageFile[] = [
    {
      id: "1",
      name: "test1.png",
      type: "image/png",
      size: 1024,
      preview: "data:image/png;base64,test1",
      base64: "data:image/png;base64,test1",
    },
    {
      id: "2",
      name: "test2.jpg",
      type: "image/jpeg",
      size: 2048,
      preview: "data:image/jpeg;base64,test2",
      base64: "data:image/jpeg;base64,test2",
    },
    {
      id: "3",
      name: "test3.gif",
      type: "image/gif",
      size: 512,
      preview: "data:image/gif;base64,test3",
      base64: "data:image/gif;base64,test3",
    },
  ];

  const mockOnClose = vi.fn();
  const mockOnDownload = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("rendering", () => {
    it("should return null when images array is empty", () => {
      const { container } = render(
        <ImagePreviewModal visible={true} images={[]} onClose={mockOnClose} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it("should return null when images is undefined", () => {
      const { container } = render(
        <ImagePreviewModal visible={true} images={undefined as any} onClose={mockOnClose} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it("should render modal when visible with single image", () => {
      render(<ImagePreviewModal visible={true} images={[mockImages[0]]} onClose={mockOnClose} />);

      expect(screen.getByText("test1.png")).toBeInTheDocument();
      expect(screen.getByText(/1024 bytes/)).toBeInTheDocument();
    });

    it("should render modal with multiple images", () => {
      render(<ImagePreviewModal visible={true} images={mockImages} onClose={mockOnClose} />);

      expect(screen.getByText("test1.png")).toBeInTheDocument();
      expect(screen.getByText(/1 of 3/)).toBeInTheDocument();
    });

    it("should not show navigation buttons for single image", () => {
      render(<ImagePreviewModal visible={true} images={[mockImages[0]]} onClose={mockOnClose} />);

      // No left/right navigation buttons in header
      const leftButtons = screen.queryAllByRole("button", { name: /previous/i });
      const rightButtons = screen.queryAllByRole("button", { name: /next/i });

      // Should be no navigation buttons in header for single image
      expect(leftButtons.length).toBe(0);
      expect(rightButtons.length).toBe(0);
    });

    it("should show navigation buttons for multiple images", () => {
      render(<ImagePreviewModal visible={true} images={mockImages} onClose={mockOnClose} />);

      // Should have left/right navigation buttons
      const leftButtons = screen.getAllByRole("button", { name: /previous/i });
      const rightButtons = screen.getAllByRole("button", { name: /next/i });

      expect(leftButtons.length).toBeGreaterThan(0);
      expect(rightButtons.length).toBeGreaterThan(0);
    });

    it("should display thumbnail strip for multiple images", () => {
      render(<ImagePreviewModal visible={true} images={mockImages} onClose={mockOnClose} />);

      // Should render thumbnails (1 main image + 3 thumbnails = 4 total)
      const thumbnails = screen.getAllByRole("img");
      expect(thumbnails.length).toBeGreaterThanOrEqual(4);
    });

    it("should not display thumbnail strip for single image", () => {
      render(<ImagePreviewModal visible={true} images={[mockImages[0]]} onClose={mockOnClose} />);

      // Only the main image should be rendered (no thumbnails)
      const images = screen.getAllByRole("img");
      // Should have exactly 1 main image (may include icon images from buttons)
      const mainImages = images.filter((img) => img.getAttribute("alt") === "test1.png");
      expect(mainImages.length).toBe(1);
    });
  });

  describe("navigation", () => {
    it("should start at currentIndex when provided", () => {
      render(
        <ImagePreviewModal
          visible={true}
          images={mockImages}
          currentIndex={1}
          onClose={mockOnClose}
        />,
      );

      expect(screen.getByText("test2.jpg")).toBeInTheDocument();
      expect(screen.getByText(/2 of 3/)).toBeInTheDocument();
    });

    it("should default to first image when currentIndex not provided", () => {
      render(<ImagePreviewModal visible={true} images={mockImages} onClose={mockOnClose} />);

      expect(screen.getByText("test1.png")).toBeInTheDocument();
      expect(screen.getByText(/1 of 3/)).toBeInTheDocument();
    });

    it("should navigate to next image when next button clicked", () => {
      render(<ImagePreviewModal visible={true} images={mockImages} onClose={mockOnClose} />);

      const nextButtons = screen.getAllByRole("button", { name: /next/i });
      fireEvent.click(nextButtons[0]);

      expect(screen.getByText("test2.jpg")).toBeInTheDocument();
      expect(screen.getByText(/2 of 3/)).toBeInTheDocument();
    });

    it("should navigate to previous image when previous button clicked", () => {
      render(
        <ImagePreviewModal
          visible={true}
          images={mockImages}
          currentIndex={1}
          onClose={mockOnClose}
        />,
      );

      const prevButtons = screen.getAllByRole("button", { name: /previous/i });
      fireEvent.click(prevButtons[0]);

      expect(screen.getByText("test1.png")).toBeInTheDocument();
      expect(screen.getByText(/1 of 3/)).toBeInTheDocument();
    });

    it("should wrap to last image when previous on first image", () => {
      render(<ImagePreviewModal visible={true} images={mockImages} onClose={mockOnClose} />);

      const prevButtons = screen.getAllByRole("button", { name: /previous/i });
      fireEvent.click(prevButtons[0]);

      expect(screen.getByText("test3.gif")).toBeInTheDocument();
      expect(screen.getByText(/3 of 3/)).toBeInTheDocument();
    });

    it("should wrap to first image when next on last image", () => {
      render(
        <ImagePreviewModal
          visible={true}
          images={mockImages}
          currentIndex={2}
          onClose={mockOnClose}
        />,
      );

      const nextButtons = screen.getAllByRole("button", { name: /next/i });
      fireEvent.click(nextButtons[0]);

      expect(screen.getByText("test1.png")).toBeInTheDocument();
      expect(screen.getByText(/1 of 3/)).toBeInTheDocument();
    });

    it("should display clickable thumbnails for multiple images", () => {
      render(<ImagePreviewModal visible={true} images={mockImages} onClose={mockOnClose} />);

      // Verify thumbnails are present and clickable
      const allImages = screen.getAllByRole("img");
      // Should have main image + thumbnails
      expect(allImages.length).toBeGreaterThan(3);

      // Thumbnails should be clickable (they're in a clickable container)
      const thumbnailContainers = screen
        .getAllByRole("img")
        .slice(1) // Skip main image
        .map((img) => img.closest("div[style*='cursor: pointer']"))
        .filter(Boolean);

      expect(thumbnailContainers.length).toBeGreaterThan(0);
    });
  });

  describe("download functionality", () => {
    it("should call onDownload callback when provided", () => {
      render(
        <ImagePreviewModal
          visible={true}
          images={[mockImages[0]]}
          onClose={mockOnClose}
          onDownload={mockOnDownload}
        />,
      );

      const downloadButton = screen.getByRole("button", { name: /download/i });
      fireEvent.click(downloadButton);

      expect(mockOnDownload).toHaveBeenCalledWith(mockImages[0]);
      expect(mockOnDownload).toHaveBeenCalledTimes(1);
    });

    it("should download current image after navigation", () => {
      render(
        <ImagePreviewModal
          visible={true}
          images={mockImages}
          onClose={mockOnClose}
          onDownload={mockOnDownload}
        />,
      );

      // Navigate to second image
      const nextButtons = screen.getAllByRole("button", { name: /next/i });
      fireEvent.click(nextButtons[0]);

      // Download
      const downloadButton = screen.getByRole("button", { name: /download/i });
      fireEvent.click(downloadButton);

      expect(mockOnDownload).toHaveBeenCalledWith(mockImages[1]);
    });
  });

  describe("close functionality", () => {
    it("should call onClose when modal close button is clicked", () => {
      render(<ImagePreviewModal visible={true} images={[mockImages[0]]} onClose={mockOnClose} />);

      // Ant Design Modal has a close button with aria-label="Close"
      const closeButton = screen.getByRole("button", { name: /close/i });
      fireEvent.click(closeButton);

      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe("accessibility", () => {
    it("should have accessible download button", () => {
      render(<ImagePreviewModal visible={true} images={[mockImages[0]]} onClose={mockOnClose} />);

      const downloadButton = screen.getByRole("button", { name: /download/i });
      expect(downloadButton).toBeInTheDocument();
    });

    it("should display image information", () => {
      render(<ImagePreviewModal visible={true} images={[mockImages[0]]} onClose={mockOnClose} />);

      expect(screen.getByText("test1.png")).toBeInTheDocument();
      expect(screen.getByText(/1024 bytes/)).toBeInTheDocument();
    });
  });

  describe("edge cases", () => {
    it("should handle images with special characters in name", () => {
      const specialImage: ImageFile = {
        id: "1",
        name: "test-image_@#$%.png",
        type: "image/png",
        size: 1024,
        preview: "data:image/png;base64,test",
        base64: "data:image/png;base64,test",
      };

      render(<ImagePreviewModal visible={true} images={[specialImage]} onClose={mockOnClose} />);

      expect(screen.getByText("test-image_@#$%.png")).toBeInTheDocument();
    });

    it("should handle images with unicode in name", () => {
      const unicodeImage: ImageFile = {
        id: "1",
        name: "图片测试🎉.png",
        type: "image/png",
        size: 1024,
        preview: "data:image/png;base64,test",
        base64: "data:image/png;base64,test",
      };

      render(<ImagePreviewModal visible={true} images={[unicodeImage]} onClose={mockOnClose} />);

      expect(screen.getByText("图片测试🎉.png")).toBeInTheDocument();
    });
  });
});
