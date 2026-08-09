import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useImageHandler } from "../useImageHandler";
import { ImageFile, processImageFiles, cleanupImagePreviews } from "../../utils/imageUtils";

// Mock imageUtils
vi.mock("../../utils/imageUtils", () => ({
  processImageFiles: vi.fn(),
  cleanupImagePreviews: vi.fn(),
}));

// Mock antd App
const mockMessage = {
  success: vi.fn(),
  error: vi.fn(),
};

vi.mock("antd", () => ({
  App: {
    useApp: () => ({ message: mockMessage }),
  },
}));

describe("useImageHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("initial state", () => {
    it("should initialize with empty images array", () => {
      const { result } = renderHook(() => useImageHandler(true));

      expect(result.current.images).toEqual([]);
    });

    it("should initialize with preview modal hidden", () => {
      const { result } = renderHook(() => useImageHandler(true));

      expect(result.current.previewModalVisible).toBe(false);
    });

    it("should initialize with preview image index 0", () => {
      const { result } = renderHook(() => useImageHandler(true));

      expect(result.current.previewImageIndex).toBe(0);
    });

    it("should return all handler functions", () => {
      const { result } = renderHook(() => useImageHandler(true));

      expect(typeof result.current.handleImageFiles).toBe("function");
      expect(typeof result.current.handleRemoveImage).toBe("function");
      expect(typeof result.current.handleImagePreview).toBe("function");
      expect(typeof result.current.clearImages).toBe("function");
      expect(typeof result.current.setImages).toBe("function");
      expect(typeof result.current.setPreviewModalVisible).toBe("function");
    });
  });

  describe("handleImageFiles", () => {
    it("should not process images when allowImages is false", async () => {
      const { result } = renderHook(() => useImageHandler(false));

      const files = [new File(["image"], "test.png", { type: "image/png" })];

      await act(async () => {
        await result.current.handleImageFiles(files);
      });

      expect(processImageFiles).not.toHaveBeenCalled();
      expect(mockMessage.success).not.toHaveBeenCalled();
    });

    it("should process images when allowImages is true", async () => {
      const mockImage: ImageFile = {
        id: "img1",
        file: new File(["image"], "test.png", { type: "image/png" }),
        preview: "blob:preview1",
      };

      vi.mocked(processImageFiles).mockResolvedValue([mockImage]);

      const { result } = renderHook(() => useImageHandler(true));

      const files = [mockImage.file];

      await act(async () => {
        await result.current.handleImageFiles(files);
      });

      expect(processImageFiles).toHaveBeenCalledWith(files);
      expect(mockMessage.success).toHaveBeenCalledWith("Added 1 image(s)");
    });

    it("should append new images to existing images", async () => {
      const mockImage1: ImageFile = {
        id: "img1",
        file: new File(["image1"], "test1.png", { type: "image/png" }),
        preview: "blob:preview1",
      };

      const mockImage2: ImageFile = {
        id: "img2",
        file: new File(["image2"], "test2.png", { type: "image/png" }),
        preview: "blob:preview2",
      };

      vi.mocked(processImageFiles)
        .mockResolvedValueOnce([mockImage1])
        .mockResolvedValueOnce([mockImage2]);

      const { result } = renderHook(() => useImageHandler(true));

      // Add first image
      await act(async () => {
        await result.current.handleImageFiles([mockImage1.file]);
      });

      expect(result.current.images).toHaveLength(1);
      expect(result.current.images[0].id).toBe("img1");

      // Add second image
      await act(async () => {
        await result.current.handleImageFiles([mockImage2.file]);
      });

      expect(result.current.images).toHaveLength(2);
      expect(result.current.images[1].id).toBe("img2");
    });

    it("should not add images when processing returns empty array", async () => {
      vi.mocked(processImageFiles).mockResolvedValue([]);

      const { result } = renderHook(() => useImageHandler(true));

      const files = [new File(["image"], "test.png", { type: "image/png" })];

      await act(async () => {
        await result.current.handleImageFiles(files);
      });

      expect(result.current.images).toHaveLength(0);
      expect(mockMessage.success).not.toHaveBeenCalled();
    });

    it("should handle processing errors", async () => {
      const error = new Error("Processing failed");
      vi.mocked(processImageFiles).mockRejectedValue(error);

      const { result } = renderHook(() => useImageHandler(true));

      const files = [new File(["image"], "test.png", { type: "image/png" })];

      await act(async () => {
        await result.current.handleImageFiles(files);
      });

      expect(mockMessage.error).toHaveBeenCalledWith(
        "Failed to process images: Error: Processing failed",
      );
    });

    it("should handle multiple images at once", async () => {
      const mockImages: ImageFile[] = [
        {
          id: "img1",
          file: new File(["image1"], "test1.png", { type: "image/png" }),
          preview: "blob:preview1",
        },
        {
          id: "img2",
          file: new File(["image2"], "test2.png", { type: "image/png" }),
          preview: "blob:preview2",
        },
        {
          id: "img3",
          file: new File(["image3"], "test3.png", { type: "image/png" }),
          preview: "blob:preview3",
        },
      ];

      vi.mocked(processImageFiles).mockResolvedValue(mockImages);

      const { result } = renderHook(() => useImageHandler(true));

      const files = mockImages.map((img) => img.file);

      await act(async () => {
        await result.current.handleImageFiles(files);
      });

      expect(result.current.images).toHaveLength(3);
      expect(mockMessage.success).toHaveBeenCalledWith("Added 3 image(s)");
    });

    it("should handle FileList input", async () => {
      const mockImage: ImageFile = {
        id: "img1",
        file: new File(["image"], "test.png", { type: "image/png" }),
        preview: "blob:preview1",
      };

      vi.mocked(processImageFiles).mockResolvedValue([mockImage]);

      const { result } = renderHook(() => useImageHandler(true));

      // Create a mock FileList
      const fileList = {
        0: mockImage.file,
        length: 1,
        item: (_index: number) => mockImage.file,
      } as FileList;

      await act(async () => {
        await result.current.handleImageFiles(fileList);
      });

      expect(processImageFiles).toHaveBeenCalledWith(fileList);
    });
  });

  describe("handleRemoveImage", () => {
    it("should remove image by id", async () => {
      const mockImage: ImageFile = {
        id: "img1",
        file: new File(["image"], "test.png", { type: "image/png" }),
        preview: "blob:preview1",
      };

      vi.mocked(processImageFiles).mockResolvedValue([mockImage]);

      const { result } = renderHook(() => useImageHandler(true));

      // Add image
      await act(async () => {
        await result.current.handleImageFiles([mockImage.file]);
      });

      expect(result.current.images).toHaveLength(1);

      // Remove image
      act(() => {
        result.current.handleRemoveImage("img1");
      });

      expect(result.current.images).toHaveLength(0);
    });

    it("should cleanup preview when removing image", async () => {
      const mockImage: ImageFile = {
        id: "img1",
        file: new File(["image"], "test.png", { type: "image/png" }),
        preview: "blob:preview1",
      };

      vi.mocked(processImageFiles).mockResolvedValue([mockImage]);

      const { result } = renderHook(() => useImageHandler(true));

      // Add image
      await act(async () => {
        await result.current.handleImageFiles([mockImage.file]);
      });

      // Remove image
      act(() => {
        result.current.handleRemoveImage("img1");
      });

      expect(cleanupImagePreviews).toHaveBeenCalledWith([mockImage]);
    });

    it("should not cleanup preview if image not found", () => {
      const { result } = renderHook(() => useImageHandler(true));

      act(() => {
        result.current.handleRemoveImage("nonexistent");
      });

      expect(cleanupImagePreviews).not.toHaveBeenCalled();
    });

    it("should handle removing image from middle of array", async () => {
      const mockImages: ImageFile[] = [
        {
          id: "img1",
          file: new File(["image1"], "test1.png", { type: "image/png" }),
          preview: "blob:preview1",
        },
        {
          id: "img2",
          file: new File(["image2"], "test2.png", { type: "image/png" }),
          preview: "blob:preview2",
        },
        {
          id: "img3",
          file: new File(["image3"], "test3.png", { type: "image/png" }),
          preview: "blob:preview3",
        },
      ];

      vi.mocked(processImageFiles).mockResolvedValue(mockImages);

      const { result } = renderHook(() => useImageHandler(true));

      // Add all images
      await act(async () => {
        await result.current.handleImageFiles(mockImages.map((img) => img.file));
      });

      expect(result.current.images).toHaveLength(3);

      // Remove middle image
      act(() => {
        result.current.handleRemoveImage("img2");
      });

      expect(result.current.images).toHaveLength(2);
      expect(result.current.images[0].id).toBe("img1");
      expect(result.current.images[1].id).toBe("img3");
    });
  });

  describe("handleImagePreview", () => {
    it("should set preview modal visible", async () => {
      const mockImage: ImageFile = {
        id: "img1",
        file: new File(["image"], "test.png", { type: "image/png" }),
        preview: "blob:preview1",
      };

      vi.mocked(processImageFiles).mockResolvedValue([mockImage]);

      const { result } = renderHook(() => useImageHandler(true));

      // Add image
      await act(async () => {
        await result.current.handleImageFiles([mockImage.file]);
      });

      // Preview image
      act(() => {
        result.current.handleImagePreview(mockImage);
      });

      expect(result.current.previewModalVisible).toBe(true);
    });

    it("should set correct preview image index", async () => {
      const mockImages: ImageFile[] = [
        {
          id: "img1",
          file: new File(["image1"], "test1.png", { type: "image/png" }),
          preview: "blob:preview1",
        },
        {
          id: "img2",
          file: new File(["image2"], "test2.png", { type: "image/png" }),
          preview: "blob:preview2",
        },
      ];

      vi.mocked(processImageFiles).mockResolvedValue(mockImages);

      const { result } = renderHook(() => useImageHandler(true));

      // Add images
      await act(async () => {
        await result.current.handleImageFiles(mockImages.map((img) => img.file));
      });

      // Preview second image
      act(() => {
        result.current.handleImagePreview(mockImages[1]);
      });

      expect(result.current.previewImageIndex).toBe(1);
    });

    it("should set index to 0 if image not found", async () => {
      const mockImage: ImageFile = {
        id: "img1",
        file: new File(["image"], "test.png", { type: "image/png" }),
        preview: "blob:preview1",
      };

      const nonExistentImage: ImageFile = {
        id: "img999",
        file: new File(["image"], "test.png", { type: "image/png" }),
        preview: "blob:preview999",
      };

      vi.mocked(processImageFiles).mockResolvedValue([mockImage]);

      const { result } = renderHook(() => useImageHandler(true));

      // Add image
      await act(async () => {
        await result.current.handleImageFiles([mockImage.file]);
      });

      // Preview non-existent image
      act(() => {
        result.current.handleImagePreview(nonExistentImage);
      });

      expect(result.current.previewImageIndex).toBe(0);
    });
  });

  describe("clearImages", () => {
    it("should clear all images", async () => {
      const mockImages: ImageFile[] = [
        {
          id: "img1",
          file: new File(["image1"], "test1.png", { type: "image/png" }),
          preview: "blob:preview1",
        },
        {
          id: "img2",
          file: new File(["image2"], "test2.png", { type: "image/png" }),
          preview: "blob:preview2",
        },
      ];

      vi.mocked(processImageFiles).mockResolvedValue(mockImages);

      const { result } = renderHook(() => useImageHandler(true));

      // Add images
      await act(async () => {
        await result.current.handleImageFiles(mockImages.map((img) => img.file));
      });

      expect(result.current.images).toHaveLength(2);

      // Clear images
      act(() => {
        result.current.clearImages();
      });

      expect(result.current.images).toHaveLength(0);
    });

    it("should cleanup previews when clearing images", async () => {
      const mockImages: ImageFile[] = [
        {
          id: "img1",
          file: new File(["image1"], "test1.png", { type: "image/png" }),
          preview: "blob:preview1",
        },
        {
          id: "img2",
          file: new File(["image2"], "test2.png", { type: "image/png" }),
          preview: "blob:preview2",
        },
      ];

      vi.mocked(processImageFiles).mockResolvedValue(mockImages);

      const { result } = renderHook(() => useImageHandler(true));

      // Add images
      await act(async () => {
        await result.current.handleImageFiles(mockImages.map((img) => img.file));
      });

      // Clear images
      act(() => {
        result.current.clearImages();
      });

      expect(cleanupImagePreviews).toHaveBeenCalledWith(mockImages);
    });

    it("should handle clearing when no images exist", () => {
      const { result } = renderHook(() => useImageHandler(true));

      act(() => {
        result.current.clearImages();
      });

      expect(cleanupImagePreviews).toHaveBeenCalledWith([]);
      expect(result.current.images).toHaveLength(0);
    });
  });

  describe("setImages", () => {
    it("should allow manual image setting", () => {
      const { result } = renderHook(() => useImageHandler(true));

      const mockImages: ImageFile[] = [
        {
          id: "img1",
          file: new File(["image"], "test.png", { type: "image/png" }),
          preview: "blob:preview1",
        },
      ];

      act(() => {
        result.current.setImages(mockImages);
      });

      expect(result.current.images).toEqual(mockImages);
    });

    it("should replace existing images", async () => {
      const mockImage1: ImageFile = {
        id: "img1",
        file: new File(["image1"], "test1.png", { type: "image/png" }),
        preview: "blob:preview1",
      };

      const mockImage2: ImageFile = {
        id: "img2",
        file: new File(["image2"], "test2.png", { type: "image/png" }),
        preview: "blob:preview2",
      };

      vi.mocked(processImageFiles).mockResolvedValue([mockImage1]);

      const { result } = renderHook(() => useImageHandler(true));

      // Add first image
      await act(async () => {
        await result.current.handleImageFiles([mockImage1.file]);
      });

      expect(result.current.images).toHaveLength(1);

      // Replace with different images
      act(() => {
        result.current.setImages([mockImage2]);
      });

      expect(result.current.images).toHaveLength(1);
      expect(result.current.images[0].id).toBe("img2");
    });
  });

  describe("setPreviewModalVisible", () => {
    it("should allow manual preview modal control", () => {
      const { result } = renderHook(() => useImageHandler(true));

      expect(result.current.previewModalVisible).toBe(false);

      act(() => {
        result.current.setPreviewModalVisible(true);
      });

      expect(result.current.previewModalVisible).toBe(true);

      act(() => {
        result.current.setPreviewModalVisible(false);
      });

      expect(result.current.previewModalVisible).toBe(false);
    });
  });

  describe("callback stability", () => {
    it("should update handleImageFiles when allowImages changes", async () => {
      const mockImage: ImageFile = {
        id: "img1",
        file: new File(["image"], "test.png", { type: "image/png" }),
        preview: "blob:preview1",
      };

      vi.mocked(processImageFiles).mockResolvedValue([mockImage]);

      const { result, rerender } = renderHook(({ allowImages }) => useImageHandler(allowImages), {
        initialProps: { allowImages: true },
      });

      // Process with allowImages=true
      await act(async () => {
        await result.current.handleImageFiles([mockImage.file]);
      });

      expect(processImageFiles).toHaveBeenCalledTimes(1);

      // Rerender with allowImages=false
      rerender({ allowImages: false });

      vi.mocked(processImageFiles).mockClear();

      // Try to process with allowImages=false
      await act(async () => {
        await result.current.handleImageFiles([mockImage.file]);
      });

      expect(processImageFiles).not.toHaveBeenCalled();
    });
  });

  describe("edge cases", () => {
    it("should handle rapid add and remove operations", async () => {
      const mockImages: ImageFile[] = Array.from({ length: 10 }, (_, i) => ({
        id: `img${i}`,
        file: new File([`image${i}`], `test${i}.png`, { type: "image/png" }),
        preview: `blob:preview${i}`,
      }));

      vi.mocked(processImageFiles).mockResolvedValue(mockImages);

      const { result } = renderHook(() => useImageHandler(true));

      // Add all images
      await act(async () => {
        await result.current.handleImageFiles(mockImages.map((img) => img.file));
      });

      expect(result.current.images).toHaveLength(10);

      // Rapidly remove images
      for (let i = 0; i < 5; i++) {
        act(() => {
          result.current.handleRemoveImage(`img${i}`);
        });
      }

      expect(result.current.images).toHaveLength(5);
      expect(result.current.images[0].id).toBe("img5");
    });

    it("should handle clearing images multiple times", async () => {
      const mockImage: ImageFile = {
        id: "img1",
        file: new File(["image"], "test.png", { type: "image/png" }),
        preview: "blob:preview1",
      };

      vi.mocked(processImageFiles).mockResolvedValue([mockImage]);

      const { result } = renderHook(() => useImageHandler(true));

      await act(async () => {
        await result.current.handleImageFiles([mockImage.file]);
      });

      // Clear multiple times
      act(() => {
        result.current.clearImages();
      });

      act(() => {
        result.current.clearImages();
      });

      act(() => {
        result.current.clearImages();
      });

      expect(result.current.images).toHaveLength(0);
    });
  });
});
