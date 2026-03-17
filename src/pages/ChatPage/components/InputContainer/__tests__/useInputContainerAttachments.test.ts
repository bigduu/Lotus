import { describe, expect, it, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInputContainerAttachments } from "../useInputContainerAttachments";
import type { ProcessedFile } from "../../../utils/fileUtils";

describe("useInputContainerAttachments", () => {
  describe("initial state", () => {
    it("should initialize with empty attachments array", () => {
      const { result } = renderHook(() => useInputContainerAttachments());
      expect(result.current.attachments).toEqual([]);
    });

    it("should return all handler functions", () => {
      const { result } = renderHook(() => useInputContainerAttachments());
      expect(typeof result.current.handleAttachmentsAdded).toBe("function");
      expect(typeof result.current.handleAttachmentRemove).toBe("function");
      expect(typeof result.current.handleClearAttachments).toBe("function");
      expect(typeof result.current.setAttachments).toBe("function");
    });
  });

  describe("handleAttachmentsAdded", () => {
    it("should add single file to empty attachments", () => {
      const { result } = renderHook(() => useInputContainerAttachments());

      const file: ProcessedFile = {
        id: "file1",
        name: "test.txt",
        content: "content",
        isBinary: false,
      };

      act(() => {
        result.current.handleAttachmentsAdded([file]);
      });

      expect(result.current.attachments).toHaveLength(1);
      expect(result.current.attachments[0]).toEqual(file);
    });

    it("should add multiple files to empty attachments", () => {
      const { result } = renderHook(() => useInputContainerAttachments());

      const files: ProcessedFile[] = [
        { id: "file1", name: "test1.txt", content: "content1", isBinary: false },
        { id: "file2", name: "test2.txt", content: "content2", isBinary: false },
      ];

      act(() => {
        result.current.handleAttachmentsAdded(files);
      });

      expect(result.current.attachments).toHaveLength(2);
      expect(result.current.attachments).toEqual(files);
    });

    it("should append files to existing attachments", () => {
      const { result } = renderHook(() => useInputContainerAttachments());

      const file1: ProcessedFile = {
        id: "file1",
        name: "test1.txt",
        content: "content1",
        isBinary: false,
      };

      const file2: ProcessedFile = {
        id: "file2",
        name: "test2.txt",
        content: "content2",
        isBinary: false,
      };

      act(() => {
        result.current.handleAttachmentsAdded([file1]);
      });

      act(() => {
        result.current.handleAttachmentsAdded([file2]);
      });

      expect(result.current.attachments).toHaveLength(2);
      expect(result.current.attachments[0]).toEqual(file1);
      expect(result.current.attachments[1]).toEqual(file2);
    });

    it("should handle adding empty array", () => {
      const { result } = renderHook(() => useInputContainerAttachments());

      act(() => {
        result.current.handleAttachmentsAdded([]);
      });

      expect(result.current.attachments).toHaveLength(0);
    });

    it("should preserve existing attachments when adding empty array", () => {
      const { result } = renderHook(() => useInputContainerAttachments());

      const file: ProcessedFile = {
        id: "file1",
        name: "test.txt",
        content: "content",
        isBinary: false,
      };

      act(() => {
        result.current.handleAttachmentsAdded([file]);
      });

      act(() => {
        result.current.handleAttachmentsAdded([]);
      });

      expect(result.current.attachments).toHaveLength(1);
    });
  });

  describe("handleAttachmentRemove", () => {
    it("should remove file by id", () => {
      const { result } = renderHook(() => useInputContainerAttachments());

      const files: ProcessedFile[] = [
        { id: "file1", name: "test1.txt", content: "content1", isBinary: false },
        { id: "file2", name: "test2.txt", content: "content2", isBinary: false },
      ];

      act(() => {
        result.current.handleAttachmentsAdded(files);
      });

      act(() => {
        result.current.handleAttachmentRemove("file1");
      });

      expect(result.current.attachments).toHaveLength(1);
      expect(result.current.attachments[0].id).toBe("file2");
    });

    it("should handle removing non-existent file", () => {
      const { result } = renderHook(() => useInputContainerAttachments());

      const file: ProcessedFile = {
        id: "file1",
        name: "test.txt",
        content: "content",
        isBinary: false,
      };

      act(() => {
        result.current.handleAttachmentsAdded([file]);
      });

      act(() => {
        result.current.handleAttachmentRemove("nonexistent");
      });

      expect(result.current.attachments).toHaveLength(1);
    });

    it("should handle removing from empty attachments", () => {
      const { result } = renderHook(() => useInputContainerAttachments());

      act(() => {
        result.current.handleAttachmentRemove("file1");
      });

      expect(result.current.attachments).toHaveLength(0);
    });

    it("should remove all files with matching id", () => {
      const { result } = renderHook(() => useInputContainerAttachments());

      const files: ProcessedFile[] = [
        { id: "file1", name: "test1.txt", content: "content1", isBinary: false },
        { id: "file1", name: "test2.txt", content: "content2", isBinary: false },
      ];

      act(() => {
        result.current.handleAttachmentsAdded(files);
      });

      expect(result.current.attachments).toHaveLength(2);

      act(() => {
        result.current.handleAttachmentRemove("file1");
      });

      // filter removes all matching files
      expect(result.current.attachments).toHaveLength(0);
    });
  });

  describe("handleClearAttachments", () => {
    it("should clear all attachments", () => {
      const { result } = renderHook(() => useInputContainerAttachments());

      const files: ProcessedFile[] = [
        { id: "file1", name: "test1.txt", content: "content1", isBinary: false },
        { id: "file2", name: "test2.txt", content: "content2", isBinary: false },
      ];

      act(() => {
        result.current.handleAttachmentsAdded(files);
      });

      act(() => {
        result.current.handleClearAttachments();
      });

      expect(result.current.attachments).toHaveLength(0);
    });

    it("should handle clearing empty attachments", () => {
      const { result } = renderHook(() => useInputContainerAttachments());

      act(() => {
        result.current.handleClearAttachments();
      });

      expect(result.current.attachments).toHaveLength(0);
    });

    it("should allow adding files after clearing", () => {
      const { result } = renderHook(() => useInputContainerAttachments());

      const file1: ProcessedFile = {
        id: "file1",
        name: "test1.txt",
        content: "content1",
        isBinary: false,
      };

      const file2: ProcessedFile = {
        id: "file2",
        name: "test2.txt",
        content: "content2",
        isBinary: false,
      };

      act(() => {
        result.current.handleAttachmentsAdded([file1]);
      });

      act(() => {
        result.current.handleClearAttachments();
      });

      act(() => {
        result.current.handleAttachmentsAdded([file2]);
      });

      expect(result.current.attachments).toHaveLength(1);
      expect(result.current.attachments[0]).toEqual(file2);
    });
  });

  describe("setAttachments", () => {
    it("should replace all attachments", () => {
      const { result } = renderHook(() => useInputContainerAttachments());

      const files: ProcessedFile[] = [
        { id: "file1", name: "test1.txt", content: "content1", isBinary: false },
      ];

      act(() => {
        result.current.setAttachments(files);
      });

      expect(result.current.attachments).toEqual(files);
    });

    it("should clear attachments when set to empty array", () => {
      const { result } = renderHook(() => useInputContainerAttachments());

      const file: ProcessedFile = {
        id: "file1",
        name: "test.txt",
        content: "content",
        isBinary: false,
      };

      act(() => {
        result.current.handleAttachmentsAdded([file]);
      });

      act(() => {
        result.current.setAttachments([]);
      });

      expect(result.current.attachments).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("should handle binary files", () => {
      const { result } = renderHook(() => useInputContainerAttachments());

      const binaryFile: ProcessedFile = {
        id: "file1",
        name: "image.png",
        content: "",
        isBinary: true,
        binarySize: 1024,
      };

      act(() => {
        result.current.handleAttachmentsAdded([binaryFile]);
      });

      expect(result.current.attachments).toHaveLength(1);
      expect(result.current.attachments[0].isBinary).toBe(true);
    });

    it("should handle files with errors", () => {
      const { result } = renderHook(() => useInputContainerAttachments());

      const fileWithError: ProcessedFile = {
        id: "file1",
        name: "error.txt",
        content: "",
        isBinary: false,
        error: "Failed to read file",
      };

      act(() => {
        result.current.handleAttachmentsAdded([fileWithError]);
      });

      expect(result.current.attachments).toHaveLength(1);
      expect(result.current.attachments[0].error).toBe("Failed to read file");
    });

    it("should handle files with preview content", () => {
      const { result } = renderHook(() => useInputContainerAttachments());

      const fileWithPreview: ProcessedFile = {
        id: "file1",
        name: "preview.txt",
        content: "full content",
        preview: "preview...",
        isBinary: false,
      };

      act(() => {
        result.current.handleAttachmentsAdded([fileWithPreview]);
      });

      expect(result.current.attachments[0].preview).toBe("preview...");
    });

    it("should handle rapid add/remove operations", () => {
      const { result } = renderHook(() => useInputContainerAttachments());

      for (let i = 0; i < 10; i++) {
        const file: ProcessedFile = {
          id: `file${i}`,
          name: `test${i}.txt`,
          content: `content${i}`,
          isBinary: false,
        };

        act(() => {
          result.current.handleAttachmentsAdded([file]);
        });
      }

      expect(result.current.attachments).toHaveLength(10);

      for (let i = 0; i < 10; i++) {
        act(() => {
          result.current.handleAttachmentRemove(`file${i}`);
        });
      }

      expect(result.current.attachments).toHaveLength(0);
    });
  });

  describe("real-world scenarios", () => {
    it("should handle typical file attachment workflow", () => {
      const { result } = renderHook(() => useInputContainerAttachments());

      // User adds files
      const files1: ProcessedFile[] = [
        { id: "file1", name: "readme.md", content: "# Readme", isBinary: false },
        { id: "file2", name: "package.json", content: "{}", isBinary: false },
      ];

      act(() => {
        result.current.handleAttachmentsAdded(files1);
      });

      expect(result.current.attachments).toHaveLength(2);

      // User removes one file
      act(() => {
        result.current.handleAttachmentRemove("file1");
      });

      expect(result.current.attachments).toHaveLength(1);
      expect(result.current.attachments[0].name).toBe("package.json");

      // User adds more files
      const files2: ProcessedFile[] = [
        { id: "file3", name: "app.ts", content: "console.log()", isBinary: false },
      ];

      act(() => {
        result.current.handleAttachmentsAdded(files2);
      });

      expect(result.current.attachments).toHaveLength(2);

      // User clears all
      act(() => {
        result.current.handleClearAttachments();
      });

      expect(result.current.attachments).toHaveLength(0);
    });

    it("should handle image and text file combination", () => {
      const { result } = renderHook(() => useInputContainerAttachments());

      const files: ProcessedFile[] = [
        { id: "img1", name: "photo.jpg", content: "", isBinary: true, binarySize: 1024000 },
        { id: "text1", name: "notes.txt", content: "Some notes", isBinary: false },
      ];

      act(() => {
        result.current.handleAttachmentsAdded(files);
      });

      expect(result.current.attachments).toHaveLength(2);
      expect(result.current.attachments.some((f) => f.isBinary)).toBe(true);
      expect(result.current.attachments.some((f) => !f.isBinary)).toBe(true);
    });
  });

  describe("type safety", () => {
    it("should maintain ProcessedFile type throughout operations", () => {
      const { result } = renderHook(() => useInputContainerAttachments());

      const file: ProcessedFile = {
        id: "file1",
        name: "test.ts",
        content: "const x = 1;",
        isBinary: false,
      };

      act(() => {
        result.current.handleAttachmentsAdded([file]);
      });

      const attachment = result.current.attachments[0];
      expect(typeof attachment.id).toBe("string");
      expect(typeof attachment.name).toBe("string");
      expect(typeof attachment.content).toBe("string");
      expect(typeof attachment.isBinary).toBe("boolean");
    });
  });
});
