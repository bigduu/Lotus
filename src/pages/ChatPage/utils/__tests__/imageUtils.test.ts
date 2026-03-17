import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canvasToBase64,
  cleanupImagePreview,
  cleanupImagePreviews,
  createImagePreview,
  extractBase64Data,
  extractImageFiles,
  fileToBase64,
  formatFileSize,
  getMimeTypeFromDataUrl,
  hasImageFiles,
  loadImage,
  loadAndValidateImage,
  processImageFile,
  processImageFiles,
  resizeImageIfNeeded,
  validateImageDimensions,
  validateImageFile,
  MAX_IMAGE_SIZE,
  MAX_IMAGE_WIDTH,
  MAX_IMAGE_HEIGHT,
  SUPPORTED_IMAGE_TYPES,
} from "../imageUtils";
import type { ImageFile } from "../imageUtils";

// Mock Image constructor
class MockImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src: string = "";
  width: number = 100;
  height: number = 100;

  constructor() {
    setTimeout(() => {
      if (this.src && this.onload) {
        this.onload();
      }
    }, 0);
  }
}

// Mock canvas
class MockCanvas {
  width: number = 0;
  height: number = 0;
  private _context2d: CanvasRenderingContext2D | null = {
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    fillStyle: "",
  } as any;

  getContext(contextId: string) {
    return contextId === "2d" ? this._context2d : null;
  }

  toDataURL(type?: string, quality?: any): string {
    return `data:${type || "image/png"};base64,mockbase64data`;
  }
}

describe("imageUtils", () => {
  let originalImage: typeof Image;
  let originalURL: typeof URL;
  let originalFileReader: typeof FileReader;

  beforeEach(() => {
    vi.clearAllMocks();

    // Store originals
    originalImage = global.Image;
    originalURL = global.URL;
    originalFileReader = global.FileReader;

    // Mock Image
    global.Image = MockImage as any;

    // Mock URL
    global.URL = {
      createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
      revokeObjectURL: vi.fn(),
    } as any;

    // Mock FileReader
    global.FileReader = class MockFileReader {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      result: string | ArrayBuffer | null = null;

      readAsDataURL(file: File) {
        setTimeout(() => {
          this.result = `data:${file.type};base64,base64data`;
          if (this.onload) this.onload();
        }, 0);
      }

      readAsText() {}
    } as any;
  });

  afterEach(() => {
    // Restore originals
    global.Image = originalImage;
    global.URL = originalURL;
    global.FileReader = originalFileReader;
  });

  // Helper to create mock image file
  function createMockImageFile(
    name: string = "test.jpg",
    type: string = "image/jpeg",
    size: number = 1024,
  ): File {
    const file = new File(["x".repeat(size)], name, { type });
    Object.defineProperty(file, "size", { value: size });
    return file;
  }

  describe("validateImageFile", () => {
    it("accepts JPEG images", () => {
      const file = createMockImageFile("photo.jpg", "image/jpeg");
      const result = validateImageFile(file);
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("accepts PNG images", () => {
      const file = createMockImageFile("image.png", "image/png");
      const result = validateImageFile(file);
      expect(result.isValid).toBe(true);
    });

    it("accepts GIF images", () => {
      const file = createMockImageFile("animation.gif", "image/gif");
      const result = validateImageFile(file);
      expect(result.isValid).toBe(true);
    });

    it("accepts WebP images", () => {
      const file = createMockImageFile("image.webp", "image/webp");
      const result = validateImageFile(file);
      expect(result.isValid).toBe(true);
    });

    it("accepts BMP images", () => {
      const file = createMockImageFile("image.bmp", "image/bmp");
      const result = validateImageFile(file);
      expect(result.isValid).toBe(true);
    });

    it("rejects unsupported image types", () => {
      const file = createMockImageFile("image.tiff", "image/tiff");
      const result = validateImageFile(file);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("Unsupported image type");
    });

    it("rejects non-image files", () => {
      const file = createMockImageFile("document.pdf", "application/pdf");
      const result = validateImageFile(file);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("Unsupported image type");
    });

    it("rejects files larger than 10MB", () => {
      const largeFile = createMockImageFile(
        "large.jpg",
        "image/jpeg",
        MAX_IMAGE_SIZE + 1,
      );
      const result = validateImageFile(largeFile);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("Image size too large");
    });

    it("accepts files at exactly 10MB", () => {
      const exactFile = createMockImageFile(
        "exact.jpg",
        "image/jpeg",
        MAX_IMAGE_SIZE,
      );
      const result = validateImageFile(exactFile);
      expect(result.isValid).toBe(true);
    });

    it("accepts files smaller than 10MB", () => {
      const smallFile = createMockImageFile("small.jpg", "image/jpeg", 1024);
      const result = validateImageFile(smallFile);
      expect(result.isValid).toBe(true);
    });
  });

  describe("loadImage", () => {
    it("resolves with HTMLImageElement on successful load", async () => {
      const promise = loadImage("test.jpg");
      await expect(promise).resolves.toBeInstanceOf(MockImage);
    });

    it("rejects on error", async () => {
      const mockImage = class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        src: string = "";

        constructor() {
          setTimeout(() => {
            // Trigger onerror instead of onload
            if (this.onerror) this.onerror();
          }, 0);
        }
      };

      global.Image = mockImage as any;

      const promise = loadImage("invalid.jpg");
      await expect(promise).rejects.toThrow("Failed to load image");
    });
  });

  describe("fileToBase64", () => {
    it("converts file to base64 string", async () => {
      const file = createMockImageFile("test.jpg", "image/jpeg");
      const result = await fileToBase64(file);
      expect(result).toContain("data:image/jpeg;base64,");
    });

    it("rejects on read error", async () => {
      global.FileReader = class MockFileReaderError {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        result: string | ArrayBuffer | null = null;

        readAsDataURL() {
          setTimeout(() => {
            if (this.onerror) this.onerror();
          }, 0);
        }
      } as any;

      const file = createMockImageFile();
      const promise = fileToBase64(file);
      await expect(promise).rejects.toThrow("Failed to read file");
    });
  });

  describe("createImagePreview", () => {
    it("creates blob URL for file", () => {
      const file = createMockImageFile();
      const preview = createImagePreview(file);
      expect(preview).toContain("blob:");
      expect(URL.createObjectURL).toHaveBeenCalledWith(file);
    });
  });

  describe("processImageFile", () => {
    it("validates and processes image file", async () => {
      const file = createMockImageFile();
      const result = await processImageFile(file);

      expect(result.file).toBe(file);
      expect(result.name).toBe("test.jpg");
      expect(result.type).toBe("image/jpeg");
      expect(result.base64).toContain("data:image/jpeg;base64,");
      expect(result.preview).toContain("blob:");
      expect(result.id).toMatch(/^img_/);
      expect(result.size).toBe(1024);
    });

    it("throws error for invalid file type", async () => {
      const file = createMockImageFile("doc.pdf", "application/pdf");
      const promise = processImageFile(file);
      await expect(promise).rejects.toThrow("Unsupported image type");
    });

    it("throws error for file too large", async () => {
      const file = createMockImageFile("large.jpg", "image/jpeg", MAX_IMAGE_SIZE + 1);
      const promise = processImageFile(file);
      await expect(promise).rejects.toThrow("Image size too large");
    });

    it("skips compression for GIF images", async () => {
      const file = createMockImageFile("animation.gif", "image/gif", 1024);
      const result = await processImageFile(file);

      expect(result.base64).toContain("data:image/gif;base64,");
    });

    it("skips compression for small files", async () => {
      const file = createMockImageFile("small.jpg", "image/jpeg", 1024);
      const result = await processImageFile(file);

      expect(result.base64).toContain("data:image/jpeg;base64,");
    });

    it("revokes preview URL on processing failure", async () => {
      global.FileReader = class MockFileReaderError {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        result: string | ArrayBuffer | null = null;

        readAsDataURL() {
          setTimeout(() => {
            if (this.onerror) this.onerror();
          }, 0);
        }
      } as any;

      const file = createMockImageFile();
      const promise = processImageFile(file);

      await expect(promise).rejects.toThrow();
      expect(URL.revokeObjectURL).toHaveBeenCalled();
    });
  });

  describe("processImageFiles", () => {
    it("processes multiple image files", async () => {
      const files = [
        createMockImageFile("1.jpg", "image/jpeg"),
        createMockImageFile("2.png", "image/png"),
      ];

      const results = await processImageFiles(files);

      expect(results).toHaveLength(2);
      expect(results[0].name).toBe("1.jpg");
      expect(results[1].name).toBe("2.png");
    });

    it("continues processing when some files fail", async () => {
      const files = [
        createMockImageFile("valid.jpg", "image/jpeg"),
        createMockImageFile("invalid.pdf", "application/pdf"),
        createMockImageFile("valid.png", "image/png"),
      ];

      const results = await processImageFiles(files);

      expect(results).toHaveLength(2);
      expect(results[0].name).toBe("valid.jpg");
      expect(results[1].name).toBe("valid.png");
    });

    it("returns empty array for no files", async () => {
      const results = await processImageFiles([]);
      expect(results).toHaveLength(0);
    });
  });

  describe("extractBase64Data", () => {
    it("extracts base64 data from data URL", () => {
      const dataUrl = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
      const result = extractBase64Data(dataUrl);
      expect(result).toBe("/9j/4AAQSkZJRg==");
    });

    it("returns original string if no comma found", () => {
      const base64 = "/9j/4AAQSkZJRg==";
      const result = extractBase64Data(base64);
      expect(result).toBe("/9j/4AAQSkZJRg==");
    });
  });

  describe("getMimeTypeFromDataUrl", () => {
    it("extracts MIME type from data URL", () => {
      const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
      const result = getMimeTypeFromDataUrl(dataUrl);
      expect(result).toBe("image/png");
    });

    it("extracts JPEG MIME type", () => {
      const dataUrl = "data:image/jpeg;base64,/9j/4AAQSkZJ";
      const result = getMimeTypeFromDataUrl(dataUrl);
      expect(result).toBe("image/jpeg");
    });

    it("returns default for invalid format", () => {
      const invalid = "not a data url";
      const result = getMimeTypeFromDataUrl(invalid);
      expect(result).toBe("image/png");
    });
  });

  describe("validateImageDimensions", () => {
    it("accepts images within limits", () => {
      const img = { width: 1920, height: 1080 } as HTMLImageElement;
      const result = validateImageDimensions(img);
      expect(result.isValid).toBe(true);
    });

    it("rejects images too wide", () => {
      const img = { width: MAX_IMAGE_WIDTH + 1, height: 100 } as HTMLImageElement;
      const result = validateImageDimensions(img);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("dimensions too large");
    });

    it("rejects images too tall", () => {
      const img = { width: 100, height: MAX_IMAGE_HEIGHT + 1 } as HTMLImageElement;
      const result = validateImageDimensions(img);
      expect(result.isValid).toBe(false);
    });

    it("accepts images at exact limits", () => {
      const img = {
        width: MAX_IMAGE_WIDTH,
        height: MAX_IMAGE_HEIGHT,
      } as HTMLImageElement;
      const result = validateImageDimensions(img);
      expect(result.isValid).toBe(true);
    });
  });

  describe("loadAndValidateImage", () => {
    it("resolves with image if dimensions valid", async () => {
      const promise = loadAndValidateImage("test.jpg");
      await expect(promise).resolves.toBeInstanceOf(MockImage);
    });

    it("rejects if dimensions too large", async () => {
      const mockImage = class extends MockImage {
        width = MAX_IMAGE_WIDTH + 1;
        height = MAX_IMAGE_HEIGHT + 1;
      };

      global.Image = mockImage as any;

      const promise = loadAndValidateImage("large.jpg");
      await expect(promise).rejects.toThrow("dimensions too large");
    });
  });

  describe("resizeImageIfNeeded", () => {
    it("resizes wide images", () => {
      const canvas = new MockCanvas() as any;
      const img = { width: 5000, height: 3000 } as HTMLImageElement;

      resizeImageIfNeeded(canvas, img, 2000, 2000);

      expect(canvas.width).toBe(2000);
      expect(canvas.height).toBe(1200); // Maintains aspect ratio
    });

    it("resizes tall images", () => {
      const canvas = new MockCanvas() as any;
      const img = { width: 3000, height: 5000 } as HTMLImageElement;

      resizeImageIfNeeded(canvas, img, 2000, 2000);

      expect(canvas.width).toBe(1200); // Maintains aspect ratio
      expect(canvas.height).toBe(2000);
    });

    it("does not resize small images", () => {
      const canvas = new MockCanvas() as any;
      const img = { width: 800, height: 600 } as HTMLImageElement;

      resizeImageIfNeeded(canvas, img, 2000, 2000);

      expect(canvas.width).toBe(800);
      expect(canvas.height).toBe(600);
    });

    it("uses default max dimensions if not specified", () => {
      const canvas = new MockCanvas() as any;
      const img = { width: 5000, height: 5000 } as HTMLImageElement;

      resizeImageIfNeeded(canvas, img);

      expect(canvas.width).toBeLessThanOrEqual(MAX_IMAGE_WIDTH);
      expect(canvas.height).toBeLessThanOrEqual(MAX_IMAGE_HEIGHT);
    });
  });

  describe("canvasToBase64", () => {
    it("converts canvas to JPEG data URL", () => {
      const canvas = new MockCanvas() as any;
      const result = canvasToBase64(canvas, 0.8);

      expect(result).toContain("data:image/jpeg;base64,");
    });

    it("uses default quality if not specified", () => {
      const canvas = new MockCanvas() as any;
      const result = canvasToBase64(canvas);

      expect(result).toContain("data:image/jpeg;base64,");
    });
  });

  describe("cleanupImagePreview", () => {
    it("revokes blob URLs", () => {
      const preview = "blob:http://example.com/test";
      cleanupImagePreview(preview);

      expect(URL.revokeObjectURL).toHaveBeenCalledWith(preview);
    });

    it("does not revoke non-blob URLs", () => {
      const preview = "data:image/jpeg;base64,test";
      cleanupImagePreview(preview);

      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    });
  });

  describe("cleanupImagePreviews", () => {
    it("cleans up multiple previews", () => {
      const images: ImageFile[] = [
        {
          file: createMockImageFile(),
          base64: "data:image/jpeg;base64,test",
          preview: "blob:http://example.com/1",
          id: "1",
          name: "test1.jpg",
          size: 1024,
          type: "image/jpeg",
        },
        {
          file: createMockImageFile(),
          base64: "data:image/jpeg;base64,test",
          preview: "blob:http://example.com/2",
          id: "2",
          name: "test2.jpg",
          size: 1024,
          type: "image/jpeg",
        },
      ];

      cleanupImagePreviews(images);

      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    });
  });

  describe("formatFileSize", () => {
    it("formats bytes", () => {
      expect(formatFileSize(512)).toBe("512 Bytes");
    });

    it("formats kilobytes", () => {
      expect(formatFileSize(2048)).toBe("2 KB");
    });

    it("formats megabytes", () => {
      expect(formatFileSize(2 * 1024 * 1024)).toBe("2 MB");
    });

    it("formats gigabytes", () => {
      expect(formatFileSize(2 * 1024 * 1024 * 1024)).toBe("2 GB");
    });

    it("handles zero bytes", () => {
      expect(formatFileSize(0)).toBe("0 Bytes");
    });
  });

  describe("hasImageFiles", () => {
    it("returns true if data transfer contains images", () => {
      const dataTransfer = {
        files: [createMockImageFile()],
      } as any;

      const result = hasImageFiles(dataTransfer);
      expect(result).toBe(true);
    });

    it("returns false if no files", () => {
      const dataTransfer = {
        files: [],
      } as any;

      const result = hasImageFiles(dataTransfer);
      expect(result).toBe(false);
    });

    it("returns false if no image files", () => {
      const dataTransfer = {
        files: [new File([""], "test.txt", { type: "text/plain" })],
      } as any;

      const result = hasImageFiles(dataTransfer);
      expect(result).toBe(false);
    });

    it("handles mixed file types", () => {
      const dataTransfer = {
        files: [
          new File([""], "test.txt", { type: "text/plain" }),
          createMockImageFile(),
        ],
      } as any;

      const result = hasImageFiles(dataTransfer);
      expect(result).toBe(true);
    });
  });

  describe("extractImageFiles", () => {
    it("extracts only image files", () => {
      const dataTransfer = {
        files: [
          createMockImageFile("1.jpg", "image/jpeg"),
          new File([""], "test.txt", { type: "text/plain" }),
          createMockImageFile("2.png", "image/png"),
        ],
      } as any;

      const result = extractImageFiles(dataTransfer);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("1.jpg");
      expect(result[1].name).toBe("2.png");
    });

    it("returns empty array if no files", () => {
      const dataTransfer = {
        files: null,
      } as any;

      const result = extractImageFiles(dataTransfer);
      expect(result).toHaveLength(0);
    });

    it("returns empty array if no image files", () => {
      const dataTransfer = {
        files: [
          new File([""], "test.txt", { type: "text/plain" }),
          new File([""], "doc.pdf", { type: "application/pdf" }),
        ],
      } as any;

      const result = extractImageFiles(dataTransfer);
      expect(result).toHaveLength(0);
    });
  });

  describe("constants", () => {
    it("MAX_IMAGE_SIZE is 10MB", () => {
      expect(MAX_IMAGE_SIZE).toBe(10 * 1024 * 1024);
    });

    it("MAX_IMAGE_WIDTH is 4096", () => {
      expect(MAX_IMAGE_WIDTH).toBe(4096);
    });

    it("MAX_IMAGE_HEIGHT is 4096", () => {
      expect(MAX_IMAGE_HEIGHT).toBe(4096);
    });

    it("SUPPORTED_IMAGE_TYPES includes common types", () => {
      expect(SUPPORTED_IMAGE_TYPES).toContain("image/jpeg");
      expect(SUPPORTED_IMAGE_TYPES).toContain("image/png");
      expect(SUPPORTED_IMAGE_TYPES).toContain("image/gif");
      expect(SUPPORTED_IMAGE_TYPES).toContain("image/webp");
    });
  });
});
