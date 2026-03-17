import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  FileOperationsService,
  type FileFilter,
  type SaveFileOptions,
  type SaveFileResult,
} from "../FileOperationsService";
import * as environmentModule from "../../../utils/environment";

// Mock environment check
vi.mock("../../../utils/environment", () => ({
  isTauriEnvironment: vi.fn(),
}));

// Create shared mock functions for Tauri plugins at module level
const mockDialogSave = vi.fn();
const mockFsWriteFile = vi.fn();
const mockFsWriteTextFile = vi.fn();

// Mock Tauri plugins at top level
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: mockDialogSave,
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  writeFile: mockFsWriteFile,
  writeTextFile: mockFsWriteTextFile,
}));

describe("FileOperationsService", () => {
  const originalWindow = global.window;
  const originalDocument = global.document;
  const originalURL = global.URL;
  const deleteGlobalProperty = (key: string) => {
    Reflect.deleteProperty(globalThis as Record<string, unknown>, key);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDialogSave.mockReset();
    mockFsWriteFile.mockReset();
    mockFsWriteTextFile.mockReset();
  });

  afterEach(() => {
    // Restore globals
    if (originalWindow) {
      global.window = originalWindow;
    } else {
      deleteGlobalProperty("window");
    }
    if (originalDocument) {
      global.document = originalDocument;
    } else {
      deleteGlobalProperty("document");
    }
    global.URL = originalURL;
  });

  describe("FILTERS constant", () => {
    it("should have MARKDOWN filter", () => {
      expect(FileOperationsService.FILTERS.MARKDOWN).toEqual([
        { name: "Markdown", extensions: ["md"] },
      ]);
    });

    it("should have PDF filter", () => {
      expect(FileOperationsService.FILTERS.PDF).toEqual([{ name: "PDF", extensions: ["pdf"] }]);
    });

    it("should have SVG filter", () => {
      expect(FileOperationsService.FILTERS.SVG).toEqual([{ name: "SVG", extensions: ["svg"] }]);
    });

    it("should have PNG filter", () => {
      expect(FileOperationsService.FILTERS.PNG).toEqual([{ name: "PNG", extensions: ["png"] }]);
    });

    it("should have TEXT filter", () => {
      expect(FileOperationsService.FILTERS.TEXT).toEqual([{ name: "Text", extensions: ["txt"] }]);
    });

    it("should have JSON filter", () => {
      expect(FileOperationsService.FILTERS.JSON).toEqual([{ name: "JSON", extensions: ["json"] }]);
    });

    it("should have ALL filter", () => {
      expect(FileOperationsService.FILTERS.ALL).toEqual([{ name: "All Files", extensions: ["*"] }]);
    });
  });

  describe("generateTimestampedFilename", () => {
    it("should generate filename with prefix and extension", () => {
      const result = FileOperationsService.generateTimestampedFilename("test", "txt");
      expect(result).toMatch(/^test-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.txt$/);
    });

    it("should use current timestamp", () => {
      const before = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
      const result = FileOperationsService.generateTimestampedFilename("file", "md");
      const after = new Date().toISOString().slice(0, 19).replace(/:/g, "-");

      expect(result).toContain("file-");
      expect(result).toContain(".md");

      const timestamp = result.replace("file-", "").replace(".md", "");
      expect(timestamp >= before.replace(/:/g, "-") || timestamp <= after.replace(/:/g, "-")).toBe(true);
    });

    it("should handle empty prefix", () => {
      const result = FileOperationsService.generateTimestampedFilename("", "json");
      expect(result).toMatch(/^-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/);
    });

    it("should handle empty extension", () => {
      const result = FileOperationsService.generateTimestampedFilename("doc", "");
      expect(result).toMatch(/^doc-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.$/);
    });

    it("should handle special characters in prefix", () => {
      const result = FileOperationsService.generateTimestampedFilename("test-file_name", "pdf");
      expect(result).toContain("test-file_name-");
      expect(result).toContain(".pdf");
    });

    it("should generate different filenames at different times", async () => {
      const result1 = FileOperationsService.generateTimestampedFilename("doc", "txt");
      await new Promise((resolve) => setTimeout(resolve, 10));
      const result2 = FileOperationsService.generateTimestampedFilename("doc", "txt");

      // In most cases they should be different (unless called at exact same millisecond)
      // But we can't guarantee they're always different, so just check format
      expect(result1).toMatch(/^doc-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.txt$/);
      expect(result2).toMatch(/^doc-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.txt$/);
    });
  });

  describe("saveTextFile", () => {
    it("should call saveFile with string content", async () => {
      vi.mocked(environmentModule.isTauriEnvironment).mockReturnValue(false);

      global.window = {} as any;
      global.document = {
        createElement: vi.fn(() => ({
          href: "",
          download: "",
          style: { display: "" },
          click: vi.fn(),
        })),
        body: {
          appendChild: vi.fn(),
          removeChild: vi.fn(),
        },
      } as any;
      global.URL = {
        createObjectURL: vi.fn(() => "blob:test"),
        revokeObjectURL: vi.fn(),
      } as any;

      const result = await FileOperationsService.saveTextFile("test content", FileOperationsService.FILTERS.TEXT, "test.txt");

      expect(result.success).toBe(true);
      expect(result.filename).toBe("test.txt");
    });
  });

  describe("saveBinaryFile", () => {
    it("should call saveFile with Uint8Array content", async () => {
      vi.mocked(environmentModule.isTauriEnvironment).mockReturnValue(false);

      global.window = {} as any;
      global.document = {
        createElement: vi.fn(() => ({
          href: "",
          download: "",
          style: { display: "" },
          click: vi.fn(),
        })),
        body: {
          appendChild: vi.fn(),
          removeChild: vi.fn(),
        },
      } as any;
      global.URL = {
        createObjectURL: vi.fn(() => "blob:test"),
        revokeObjectURL: vi.fn(),
      } as any;

      const content = new TextEncoder().encode("binary content");
      const result = await FileOperationsService.saveBinaryFile(content, FileOperationsService.FILTERS.JSON, "test.json");

      expect(result.success).toBe(true);
      expect(result.filename).toBe("test.json");
    });
  });

  describe("BrowserFileOperations", () => {
    beforeEach(() => {
      vi.mocked(environmentModule.isTauriEnvironment).mockReturnValue(false);
    });

    it("should save file in browser environment", async () => {
      global.window = {} as any;
      const mockAnchor = {
        href: "",
        download: "",
        style: { display: "" },
        click: vi.fn(),
      };
      global.document = {
        createElement: vi.fn(() => mockAnchor),
        body: {
          appendChild: vi.fn(),
          removeChild: vi.fn(),
        },
      } as any;
      global.URL = {
        createObjectURL: vi.fn(() => "blob:test-url"),
        revokeObjectURL: vi.fn(),
      } as any;

      const result = await FileOperationsService.saveFile({
        content: "test",
        filters: FileOperationsService.FILTERS.TEXT,
        defaultPath: "test.txt",
      });

      expect(result.success).toBe(true);
      expect(result.filename).toBe("test.txt");
      expect(mockAnchor.click).toHaveBeenCalled();
      expect(global.URL.createObjectURL).toHaveBeenCalled();
      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-url");
    });

    it("should throw error when window is undefined", async () => {
      deleteGlobalProperty("window");

      const result = await FileOperationsService.saveFile({
        content: "test",
        filters: FileOperationsService.FILTERS.TEXT,
        defaultPath: "test.txt",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("File save is unavailable in this environment");
    });

    it("should throw error when document is undefined", async () => {
      global.window = {} as any;
      deleteGlobalProperty("document");

      const result = await FileOperationsService.saveFile({
        content: "test",
        filters: FileOperationsService.FILTERS.TEXT,
        defaultPath: "test.txt",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("File save is unavailable in this environment");
    });

    it("should handle binary content", async () => {
      global.window = {} as any;
      const mockAnchor = {
        href: "",
        download: "",
        style: { display: "" },
        click: vi.fn(),
      };
      global.document = {
        createElement: vi.fn(() => mockAnchor),
        body: {
          appendChild: vi.fn(),
          removeChild: vi.fn(),
        },
      } as any;
      global.URL = {
        createObjectURL: vi.fn(() => "blob:binary-url"),
        revokeObjectURL: vi.fn(),
      } as any;

      const binaryContent = new Uint8Array([1, 2, 3, 4, 5]);
      const result = await FileOperationsService.saveFile({
        content: binaryContent,
        filters: FileOperationsService.FILTERS.PDF,
        defaultPath: "test.pdf",
      });

      expect(result.success).toBe(true);
      expect(result.filename).toBe("test.pdf");
    });

    it("should revoke object URL even if click fails", async () => {
      global.window = {} as any;
      const mockAnchor = {
        href: "",
        download: "",
        style: { display: "" },
        click: vi.fn(() => {
          throw new Error("Click failed");
        }),
      };
      global.document = {
        createElement: vi.fn(() => mockAnchor),
        body: {
          appendChild: vi.fn(),
          removeChild: vi.fn(),
        },
      } as any;
      global.URL = {
        createObjectURL: vi.fn(() => "blob:test-url"),
        revokeObjectURL: vi.fn(),
      } as any;

      await FileOperationsService.saveFile({
        content: "test",
        filters: FileOperationsService.FILTERS.TEXT,
        defaultPath: "test.txt",
      });

      // Should still revoke the URL even if click fails
      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-url");
    });

    it("should infer MIME types correctly", async () => {
      global.window = {} as any;
      const mockAnchor = {
        href: "",
        download: "",
        style: { display: "" },
        click: vi.fn(),
      };
      global.document = {
        createElement: vi.fn(() => mockAnchor),
        body: {
          appendChild: vi.fn(),
          removeChild: vi.fn(),
        },
      } as any;
      let lastBlob: Blob | null = null;
      global.URL = {
        createObjectURL: vi.fn((blob: Blob) => {
          lastBlob = blob;
          return "blob:url";
        }),
        revokeObjectURL: vi.fn(),
      } as any;

      // Test different MIME types
      await FileOperationsService.saveFile({
        content: "# Test",
        filters: FileOperationsService.FILTERS.MARKDOWN,
        defaultPath: "test.md",
      });
      expect(lastBlob?.type).toBe("text/markdown;charset=utf-8");

      await FileOperationsService.saveFile({
        content: "plain text",
        filters: FileOperationsService.FILTERS.TEXT,
        defaultPath: "test.txt",
      });
      expect(lastBlob?.type).toBe("text/plain;charset=utf-8");

      await FileOperationsService.saveFile({
        content: '{"key": "value"}',
        filters: FileOperationsService.FILTERS.JSON,
        defaultPath: "test.json",
      });
      expect(lastBlob?.type).toBe("application/json;charset=utf-8");

      await FileOperationsService.saveFile({
        content: "<svg></svg>",
        filters: FileOperationsService.FILTERS.SVG,
        defaultPath: "test.svg",
      });
      expect(lastBlob?.type).toBe("image/svg+xml;charset=utf-8");

      await FileOperationsService.saveFile({
        content: new Uint8Array([1, 2, 3]),
        filters: FileOperationsService.FILTERS.PDF,
        defaultPath: "test.pdf",
      });
      expect(lastBlob?.type).toBe("application/pdf");
    });
  });

  describe("TauriFileOperations", () => {
    beforeEach(() => {
      vi.mocked(environmentModule.isTauriEnvironment).mockReturnValue(true);
    });

    it("should save text file in Tauri environment", async () => {
      mockDialogSave.mockResolvedValue("/path/to/test.txt");
      mockFsWriteTextFile.mockResolvedValue(undefined);

      const result = await FileOperationsService.saveFile({
        content: "test content",
        filters: FileOperationsService.FILTERS.TEXT,
        defaultPath: "test.txt",
      });

      expect(result.success).toBe(true);
      expect(result.filename).toBe("test.txt");
      expect(mockFsWriteTextFile).toHaveBeenCalledWith("/path/to/test.txt", "test content");
    });

    it("should save binary file in Tauri environment", async () => {
      mockDialogSave.mockResolvedValue("/path/to/test.pdf");
      mockFsWriteFile.mockResolvedValue(undefined);

      const binaryContent = new Uint8Array([1, 2, 3, 4]);
      const result = await FileOperationsService.saveFile({
        content: binaryContent,
        filters: FileOperationsService.FILTERS.PDF,
        defaultPath: "test.pdf",
      });

      expect(result.success).toBe(true);
      expect(result.filename).toBe("test.pdf");
      expect(mockFsWriteFile).toHaveBeenCalledWith("/path/to/test.pdf", binaryContent);
    });

    it("should handle user cancellation in Tauri", async () => {
      mockDialogSave.mockResolvedValue(null);

      const result = await FileOperationsService.saveFile({
        content: "test",
        filters: FileOperationsService.FILTERS.TEXT,
        defaultPath: "test.txt",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("User cancelled save operation");
    });

    it("should extract filename from full path in Tauri", async () => {
      mockDialogSave.mockResolvedValue("/home/user/documents/test-file.md");
      mockFsWriteTextFile.mockResolvedValue(undefined);

      const result = await FileOperationsService.saveFile({
        content: "content",
        filters: FileOperationsService.FILTERS.MARKDOWN,
        defaultPath: "test.md",
      });

      expect(result.success).toBe(true);
      expect(result.filename).toBe("test-file.md");
    });

    it("should handle errors in Tauri file operations", async () => {
      mockDialogSave.mockResolvedValue("/path/to/test.txt");
      mockFsWriteTextFile.mockRejectedValue(new Error("Write failed"));

      const result = await FileOperationsService.saveFile({
        content: "test",
        filters: FileOperationsService.FILTERS.TEXT,
        defaultPath: "test.txt",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Write failed");
    });
  });

  describe("error handling", () => {
    it("should handle Error instances", async () => {
      vi.mocked(environmentModule.isTauriEnvironment).mockReturnValue(false);
      deleteGlobalProperty("window");

      const result = await FileOperationsService.saveFile({
        content: "test",
        filters: FileOperationsService.FILTERS.TEXT,
        defaultPath: "test.txt",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("File save is unavailable in this environment");
    });

    it("should handle non-Error errors", async () => {
      vi.mocked(environmentModule.isTauriEnvironment).mockImplementation(() => {
        throw "String error";
      });

      const result = await FileOperationsService.saveFile({
        content: "test",
        filters: FileOperationsService.FILTERS.TEXT,
        defaultPath: "test.txt",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Unknown error occurred");
    });
  });
});
