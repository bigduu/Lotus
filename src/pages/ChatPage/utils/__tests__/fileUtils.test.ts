import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  processFiles,
  separateImageFiles,
  summarizeAttachments,
} from "../fileUtils";
import type { ProcessedFile } from "../fileUtils";

// Helper to create mock files
function createMockFile(
  content: string,
  name: string,
  type: string,
  lastModified?: number,
): File {
  return new File([content], name, { type, lastModified });
}

// Helper to create a binary file
function createMockBinaryFile(
  size: number,
  name: string,
  type: string = "application/octet-stream",
  lastModified?: number,
): File {
  const buffer = new ArrayBuffer(size);
  return new File([buffer], name, { type, lastModified });
}

describe("fileUtils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("hasTextExtension (tested via processFiles)", () => {
    it("detects common text extensions", async () => {
      const files = [
        createMockFile("content", "test.txt", "text/plain"),
        createMockFile("# Header", "README.md", ""),
        createMockFile("{}", "config.json", "application/json"),
        createMockFile("console.log()", "script.js", ""),
        createMockFile("<html></html>", "page.html", ""),
      ];

      const { processed } = await processFiles(files);

      expect(processed.every((f) => f.kind === "text")).toBe(true);
    });

    it("performs case-insensitive matching", async () => {
      const files = [
        createMockFile("content", "FILE.TXT", ""),
        createMockFile("content", "Script.JS", ""),
        createMockFile("content", "Readme.MD", ""),
      ];

      const { processed } = await processFiles(files);

      expect(processed.every((f) => f.kind === "text")).toBe(true);
    });
  });

  describe("isTextLike (tested via processFiles)", () => {
    it("detects text by MIME type", async () => {
      const files = [
        createMockFile("plain text", "file.txt", "text/plain"),
        createMockFile("{}", "data.json", "application/json"),
        createMockFile("<xml/>", "data.xml", "application/xml"),
      ];

      const { processed } = await processFiles(files);

      expect(processed.every((f) => f.kind === "text")).toBe(true);
    });

    it("detects text by extension fallback when type is empty", async () => {
      const file = createMockFile("content", "config.yaml", "");
      const { processed } = await processFiles([file]);

      expect(processed[0].kind).toBe("text");
      expect(processed[0].content).toBe("content");
    });
  });

  describe("formatFileSize (tested via binary files)", () => {
    it("formats bytes correctly", async () => {
      const file = createMockBinaryFile(512, "small.bin");
      const { processed } = await processFiles([file]);

      expect(processed[0].preview).toContain("512 B");
    });

    it("formats kilobytes correctly", async () => {
      const file = createMockBinaryFile(2048, "medium.bin");
      const { processed } = await processFiles([file]);

      expect(processed[0].preview).toContain("2.0 KB");
    });

    it("formats megabytes correctly", async () => {
      const file = createMockBinaryFile(2 * 1024 * 1024, "large.bin");
      const { processed } = await processFiles([file]);

      expect(processed[0].preview).toContain("2.00 MB");
    });
  });

  describe("processFiles", () => {
    it("processes text files under limit", async () => {
      const file = createMockFile("Hello, World!", "test.txt", "text/plain");
      const { processed, errors } = await processFiles([file]);

      expect(errors).toHaveLength(0);
      expect(processed).toHaveLength(1);
      expect(processed[0].kind).toBe("text");
      expect(processed[0].content).toBe("Hello, World!");
      expect(processed[0].preview).toBe("Hello, World!");
    });

    it("marks binary files correctly", async () => {
      const file = createMockBinaryFile(1024, "binary.dat");
      const { processed, errors } = await processFiles([file]);

      expect(errors).toHaveLength(0);
      expect(processed).toHaveLength(1);
      expect(processed[0].kind).toBe("binary");
      expect(processed[0].content).toBeUndefined();
      expect(processed[0].preview).toContain("Preview unavailable");
    });

    it("truncates long previews", async () => {
      const longContent = "a".repeat(500);
      const file = createMockFile(longContent, "long.txt", "text/plain");
      const { processed } = await processFiles([file]);

      expect(processed[0].preview.length).toBeLessThan(longContent.length);
      expect(processed[0].preview).toContain("…");
      expect(processed[0].content).toBe(longContent);
    });

    it("does not truncate short previews", async () => {
      const shortContent = "short content";
      const file = createMockFile(shortContent, "short.txt", "text/plain");
      const { processed } = await processFiles([file]);

      expect(processed[0].preview).toBe(shortContent);
    });

    it("collects errors for failed files", async () => {
      // Create a file that will fail to read
      const file = createMockFile("content", "test.txt", "text/plain");

      // Mock FileReader to simulate error
      const originalFileReader = global.FileReader;
      global.FileReader = class MockFileReader {
        onerror: (() => void) | null = null;
        onload: (() => void) | null = null;
        error = new Error("Read error");
        result = null;

        readAsText() {
          setTimeout(() => {
            if (this.onerror) this.onerror();
          }, 0);
        }
      } as any;

      const { processed, errors } = await processFiles([file]);

      expect(processed).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("Failed to process test.txt");

      global.FileReader = originalFileReader;
    });

    it("processes multiple files", async () => {
      const files = [
        createMockFile("content1", "file1.txt", "text/plain"),
        createMockFile("content2", "file2.txt", "text/plain"),
        createMockBinaryFile(100, "binary.bin"),
      ];

      const { processed, errors } = await processFiles(files);

      expect(errors).toHaveLength(0);
      expect(processed).toHaveLength(3);
      expect(processed.filter((f) => f.kind === "text")).toHaveLength(2);
      expect(processed.filter((f) => f.kind === "binary")).toHaveLength(1);
    });

    it("respects custom limitBytes option", async () => {
      const smallFile = createMockFile("small", "small.txt", "text/plain");
      const largeFile = createMockFile(
        "a".repeat(1024),
        "large.txt",
        "text/plain",
      );

      const { processed } = await processFiles([smallFile, largeFile], {
        limitBytes: 100,
      });

      expect(processed[0].kind).toBe("text");
      expect(processed[1].kind).toBe("binary");
    });

    it("sets correct properties for text files", async () => {
      const file = createMockFile("test content", "test.txt", "text/plain", 1234567890);

      const { processed } = await processFiles([file]);

      expect(processed[0].name).toBe("test.txt");
      expect(processed[0].size).toBe(12);
      expect(processed[0].type).toBe("text/plain");
      expect(processed[0].kind).toBe("text");
      expect(processed[0].content).toBe("test content");
      expect(processed[0].preview).toBe("test content");
      expect(processed[0].lastModified).toBe(1234567890);
      expect(processed[0].id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it("sets correct properties for binary files", async () => {
      const file = createMockBinaryFile(1024, "data.bin", "application/octet-stream", 9876543210);

      const { processed } = await processFiles([file]);

      expect(processed[0].name).toBe("data.bin");
      expect(processed[0].size).toBe(1024);
      expect(processed[0].type).toBe("application/octet-stream");
      expect(processed[0].kind).toBe("binary");
      expect(processed[0].content).toBeUndefined();
      expect(processed[0].lastModified).toBe(9876543210);
    });

    it("uses default type when file type is empty for text files", async () => {
      const file = createMockFile("content", "test.txt", "");
      const { processed } = await processFiles([file]);

      expect(processed[0].type).toBe("text/plain");
    });

    it("uses default type when file type is empty for binary files", async () => {
      const file = createMockBinaryFile(100, "data.bin", "");
      const { processed } = await processFiles([file]);

      expect(processed[0].type).toBe("application/octet-stream");
    });
  });

  describe("separateImageFiles", () => {
    it("separates images from other files", () => {
      const files = [
        createMockFile("", "image1.jpg", "image/jpeg"),
        createMockFile("", "doc.txt", "text/plain"),
        createMockFile("", "image2.png", "image/png"),
        createMockFile("", "data.json", "application/json"),
      ];

      const { images, others } = separateImageFiles(files);

      expect(images).toHaveLength(2);
      expect(images.map((f) => f.name)).toEqual(["image1.jpg", "image2.png"]);
      expect(others).toHaveLength(2);
      expect(others.map((f) => f.name)).toEqual(["doc.txt", "data.json"]);
    });

    it("returns empty arrays when no files provided", () => {
      const { images, others } = separateImageFiles([]);

      expect(images).toHaveLength(0);
      expect(others).toHaveLength(0);
    });

    it("handles all image files", () => {
      const files = [
        createMockFile("", "image.jpg", "image/jpeg"),
        createMockFile("", "image.png", "image/png"),
        createMockFile("", "image.gif", "image/gif"),
      ];

      const { images, others } = separateImageFiles(files);

      expect(images).toHaveLength(3);
      expect(others).toHaveLength(0);
    });

    it("handles all non-image files", () => {
      const files = [
        createMockFile("", "doc.txt", "text/plain"),
        createMockFile("", "data.json", "application/json"),
      ];

      const { images, others } = separateImageFiles(files);

      expect(images).toHaveLength(0);
      expect(others).toHaveLength(2);
    });

    it("detects images by MIME type starting with image/", () => {
      const files = [
        createMockFile("", "custom.img", "image/custom"),
        createMockFile("", "photo.svg", "image/svg+xml"),
      ];

      const { images, others } = separateImageFiles(files);

      expect(images).toHaveLength(2);
      expect(others).toHaveLength(0);
    });
  });

  describe("summarizeAttachments", () => {
    it("returns empty string for empty attachments", () => {
      expect(summarizeAttachments([])).toBe("");
    });

    it("formats text files correctly", () => {
      const attachments: ProcessedFile[] = [
        {
          id: "1",
          file: createMockFile("", "test.txt", "text/plain"),
          name: "test.txt",
          size: 100,
          type: "text/plain",
          kind: "text",
          content: "Hello, World!",
          preview: "Hello, World!",
          lastModified: 0,
        },
      ];

      const summary = summarizeAttachments(attachments);

      expect(summary).toContain("### File: test.txt");
      expect(summary).toContain("100 B");
      expect(summary).toContain("text/plain");
      expect(summary).toContain("Hello, World!");
      expect(summary).toContain("```");
    });

    it("formats binary files correctly", () => {
      const attachments: ProcessedFile[] = [
        {
          id: "1",
          file: createMockBinaryFile(1024, "data.bin"),
          name: "data.bin",
          size: 1024,
          type: "application/octet-stream",
          kind: "binary",
          preview: "(1.0 KB) Preview unavailable for this file type.",
          lastModified: 0,
        },
      ];

      const summary = summarizeAttachments(attachments);

      expect(summary).toContain("### File: data.bin");
      expect(summary).toContain("1.0 KB");
      expect(summary).toContain("application/octet-stream");
      expect(summary).toContain("Preview unavailable");
    });

    it("handles multiple files", () => {
      const attachments: ProcessedFile[] = [
        {
          id: "1",
          file: createMockFile("", "file1.txt", "text/plain"),
          name: "file1.txt",
          size: 50,
          type: "text/plain",
          kind: "text",
          content: "content1",
          preview: "content1",
          lastModified: 0,
        },
        {
          id: "2",
          file: createMockBinaryFile(2048, "file2.bin"),
          name: "file2.bin",
          size: 2048,
          type: "application/octet-stream",
          kind: "binary",
          preview: "(2.0 KB) Preview unavailable",
          lastModified: 0,
        },
      ];

      const summary = summarizeAttachments(attachments);

      expect(summary).toContain("### File: file1.txt");
      expect(summary).toContain("### File: file2.bin");
      expect(summary).toContain("content1");
      expect(summary).toContain("Preview unavailable");
    });

    it("handles files with unknown type", () => {
      const attachments: ProcessedFile[] = [
        {
          id: "1",
          file: createMockFile("", "file.txt", ""),
          name: "file.txt",
          size: 100,
          type: "",
          kind: "text",
          content: "content",
          preview: "content",
          lastModified: 0,
        },
      ];

      const summary = summarizeAttachments(attachments);

      expect(summary).toContain("unknown");
    });

    it("escapes code blocks in content", () => {
      const attachments: ProcessedFile[] = [
        {
          id: "1",
          file: createMockFile("", "code.txt", "text/plain"),
          name: "code.txt",
          size: 100,
          type: "text/plain",
          kind: "text",
          content: 'const code = "test";',
          preview: 'const code = "test";',
          lastModified: 0,
        },
      ];

      const summary = summarizeAttachments(attachments);

      // Content should be wrapped in code blocks
      expect(summary).toContain("```");
      expect(summary).toContain('const code = "test";');
    });
  });

  describe("edge cases", () => {
    it("handles files with very long names", async () => {
      const longName = "a".repeat(255) + ".txt";
      const file = createMockFile("content", longName, "text/plain");
      const { processed } = await processFiles([file]);

      expect(processed[0].name).toBe(longName);
    });

    it("handles files with special characters in name", async () => {
      const specialName = "file-with_special.chars@123#$.txt";
      const file = createMockFile("content", specialName, "text/plain");
      const { processed } = await processFiles([file]);

      expect(processed[0].name).toBe(specialName);
    });

    it("handles empty text files", async () => {
      const file = createMockFile("", "empty.txt", "text/plain");
      const { processed } = await processFiles([file]);

      expect(processed[0].kind).toBe("text");
      expect(processed[0].content).toBe("");
      expect(processed[0].preview).toBe("");
    });

    it("handles files at exactly the size limit", async () => {
      const exactLimit = 200 * 1024;
      const content = "a".repeat(exactLimit);
      const file = createMockFile(content, "limit.txt", "text/plain");
      const { processed } = await processFiles([file]);

      expect(processed[0].kind).toBe("text");
      expect(processed[0].content).toBe(content);
    });

    it("handles files just over the size limit", async () => {
      const overLimit = 200 * 1024 + 1;
      const content = "a".repeat(overLimit);
      const file = createMockFile(content, "over.txt", "text/plain");
      const { processed } = await processFiles([file]);

      expect(processed[0].kind).toBe("binary");
    });
  });
});
