import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDragAndDrop } from "../useDragAndDrop";

// Mock imageUtils
vi.mock("../../utils/imageUtils", () => ({
  hasImageFiles: vi.fn(),
  extractImageFiles: vi.fn(),
}));

import { hasImageFiles, extractImageFiles } from "../../utils/imageUtils";

describe("useDragAndDrop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("initial state", () => {
    it("should initialize with isDragOver false", () => {
      const onFiles = vi.fn();
      const { result } = renderHook(() =>
        useDragAndDrop({ onFiles }),
      );

      expect(result.current.isDragOver).toBe(false);
    });

    it("should return handler functions", () => {
      const onFiles = vi.fn();
      const { result } = renderHook(() =>
        useDragAndDrop({ onFiles }),
      );

      expect(typeof result.current.handleDragOver).toBe("function");
      expect(typeof result.current.handleDragLeave).toBe("function");
      expect(typeof result.current.handleDrop).toBe("function");
    });

    it("should default to images mode", () => {
      const onFiles = vi.fn();
      const { result } = renderHook(() =>
        useDragAndDrop({ onFiles }),
      );

      // Test behavior - in images mode, it checks hasImageFiles
      const mockEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: {},
      } as any;

      vi.mocked(hasImageFiles).mockReturnValue(false);

      act(() => {
        result.current.handleDragOver(mockEvent);
      });

      expect(hasImageFiles).toHaveBeenCalled();
    });
  });

  describe("handleDragOver - images mode", () => {
    it("should prevent default and stop propagation", () => {
      const onFiles = vi.fn();
      const { result } = renderHook(() =>
        useDragAndDrop({ onFiles, mode: "images" }),
      );

      const mockEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: {},
      } as any;

      vi.mocked(hasImageFiles).mockReturnValue(false);

      act(() => {
        result.current.handleDragOver(mockEvent);
      });

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(mockEvent.stopPropagation).toHaveBeenCalled();
    });

    it("should set isDragOver to true when images are present", () => {
      const onFiles = vi.fn();
      const { result } = renderHook(() =>
        useDragAndDrop({ onFiles, mode: "images" }),
      );

      const mockEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: {},
      } as any;

      vi.mocked(hasImageFiles).mockReturnValue(true);

      act(() => {
        result.current.handleDragOver(mockEvent);
      });

      expect(result.current.isDragOver).toBe(true);
    });

    it("should not set isDragOver when no images are present", () => {
      const onFiles = vi.fn();
      const { result } = renderHook(() =>
        useDragAndDrop({ onFiles, mode: "images" }),
      );

      const mockEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: {},
      } as any;

      vi.mocked(hasImageFiles).mockReturnValue(false);

      act(() => {
        result.current.handleDragOver(mockEvent);
      });

      expect(result.current.isDragOver).toBe(false);
    });
  });

  describe("handleDragOver - any mode", () => {
    it("should set isDragOver to true when any files are present", () => {
      const onFiles = vi.fn();
      const { result } = renderHook(() =>
        useDragAndDrop({ onFiles, mode: "any" }),
      );

      const mockEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: {
          files: [new File(["test"], "test.txt")],
        },
      } as any;

      act(() => {
        result.current.handleDragOver(mockEvent);
      });

      expect(result.current.isDragOver).toBe(true);
    });

    it("should not set isDragOver when no files are present", () => {
      const onFiles = vi.fn();
      const { result } = renderHook(() =>
        useDragAndDrop({ onFiles, mode: "any" }),
      );

      const mockEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: {
          files: [],
        },
      } as any;

      act(() => {
        result.current.handleDragOver(mockEvent);
      });

      expect(result.current.isDragOver).toBe(false);
    });

    it("should handle missing dataTransfer", () => {
      const onFiles = vi.fn();
      const { result } = renderHook(() =>
        useDragAndDrop({ onFiles, mode: "any" }),
      );

      const mockEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: null,
      } as any;

      act(() => {
        result.current.handleDragOver(mockEvent);
      });

      expect(result.current.isDragOver).toBe(false);
    });
  });

  describe("handleDragLeave", () => {
    it("should prevent default and stop propagation", () => {
      const onFiles = vi.fn();
      const { result } = renderHook(() =>
        useDragAndDrop({ onFiles }),
      );

      const mockEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as any;

      act(() => {
        result.current.handleDragLeave(mockEvent);
      });

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(mockEvent.stopPropagation).toHaveBeenCalled();
    });

    it("should set isDragOver to false", () => {
      const onFiles = vi.fn();
      const { result } = renderHook(() =>
        useDragAndDrop({ onFiles, mode: "images" }),
      );

      // First, set isDragOver to true
      const dragOverEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: {},
      } as any;

      vi.mocked(hasImageFiles).mockReturnValue(true);

      act(() => {
        result.current.handleDragOver(dragOverEvent);
      });

      expect(result.current.isDragOver).toBe(true);

      // Now, drag leave
      const dragLeaveEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as any;

      act(() => {
        result.current.handleDragLeave(dragLeaveEvent);
      });

      expect(result.current.isDragOver).toBe(false);
    });
  });

  describe("handleDrop - images mode", () => {
    it("should prevent default and stop propagation", () => {
      const onFiles = vi.fn();
      const { result } = renderHook(() =>
        useDragAndDrop({ onFiles, mode: "images" }),
      );

      const mockEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: {},
      } as any;

      vi.mocked(extractImageFiles).mockReturnValue([]);

      act(() => {
        result.current.handleDrop(mockEvent);
      });

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(mockEvent.stopPropagation).toHaveBeenCalled();
    });

    it("should set isDragOver to false", () => {
      const onFiles = vi.fn();
      const { result } = renderHook(() =>
        useDragAndDrop({ onFiles, mode: "images" }),
      );

      // First, set isDragOver to true
      const dragOverEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: {},
      } as any;

      vi.mocked(hasImageFiles).mockReturnValue(true);

      act(() => {
        result.current.handleDragOver(dragOverEvent);
      });

      expect(result.current.isDragOver).toBe(true);

      // Now, drop
      const dropEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: {},
      } as any;

      vi.mocked(extractImageFiles).mockReturnValue([]);

      act(() => {
        result.current.handleDrop(dropEvent);
      });

      expect(result.current.isDragOver).toBe(false);
    });

    it("should call onFiles with extracted images", () => {
      const onFiles = vi.fn();
      const { result } = renderHook(() =>
        useDragAndDrop({ onFiles, mode: "images" }),
      );

      const imageFile = new File(["image"], "test.png", { type: "image/png" });
      const mockEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: {},
      } as any;

      vi.mocked(extractImageFiles).mockReturnValue([imageFile]);

      act(() => {
        result.current.handleDrop(mockEvent);
      });

      expect(onFiles).toHaveBeenCalledWith([imageFile]);
    });

    it("should not call onFiles when no images are dropped", () => {
      const onFiles = vi.fn();
      const { result } = renderHook(() =>
        useDragAndDrop({ onFiles, mode: "images" }),
      );

      const mockEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: {},
      } as any;

      vi.mocked(extractImageFiles).mockReturnValue([]);

      act(() => {
        result.current.handleDrop(mockEvent);
      });

      expect(onFiles).not.toHaveBeenCalled();
    });

    it("should handle multiple images", () => {
      const onFiles = vi.fn();
      const { result } = renderHook(() =>
        useDragAndDrop({ onFiles, mode: "images" }),
      );

      const image1 = new File(["image1"], "test1.png", { type: "image/png" });
      const image2 = new File(["image2"], "test2.jpg", { type: "image/jpeg" });
      const mockEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: {},
      } as any;

      vi.mocked(extractImageFiles).mockReturnValue([image1, image2]);

      act(() => {
        result.current.handleDrop(mockEvent);
      });

      expect(onFiles).toHaveBeenCalledWith([image1, image2]);
    });
  });

  describe("handleDrop - any mode", () => {
    it("should call onFiles with all dropped files", () => {
      const onFiles = vi.fn();
      const { result } = renderHook(() =>
        useDragAndDrop({ onFiles, mode: "any" }),
      );

      const textFile = new File(["text"], "test.txt", { type: "text/plain" });
      const pdfFile = new File(["pdf"], "test.pdf", { type: "application/pdf" });
      const mockEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: {
          files: [textFile, pdfFile],
        },
      } as any;

      act(() => {
        result.current.handleDrop(mockEvent);
      });

      expect(onFiles).toHaveBeenCalledWith([textFile, pdfFile]);
    });

    it("should not call onFiles when no files are dropped", () => {
      const onFiles = vi.fn();
      const { result } = renderHook(() =>
        useDragAndDrop({ onFiles, mode: "any" }),
      );

      const mockEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: {
          files: [],
        },
      } as any;

      act(() => {
        result.current.handleDrop(mockEvent);
      });

      expect(onFiles).not.toHaveBeenCalled();
    });

    it("should handle missing files property", () => {
      const onFiles = vi.fn();
      const { result } = renderHook(() =>
        useDragAndDrop({ onFiles, mode: "any" }),
      );

      const mockEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: {},
      } as any;

      act(() => {
        result.current.handleDrop(mockEvent);
      });

      expect(onFiles).not.toHaveBeenCalled();
    });
  });

  describe("callback stability", () => {
    it("should update handlers when mode changes", () => {
      const onFiles = vi.fn();
      const { result, rerender } = renderHook(
        ({ mode }) => useDragAndDrop({ onFiles, mode }),
        { initialProps: { mode: "images" as const } },
      );

      const mockEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: {},
      } as any;

      vi.mocked(hasImageFiles).mockReturnValue(true);

      act(() => {
        result.current.handleDragOver(mockEvent);
      });

      expect(hasImageFiles).toHaveBeenCalled();

      rerender({ mode: "any" });

      vi.mocked(hasImageFiles).mockClear();

      act(() => {
        result.current.handleDragOver(mockEvent);
      });

      // In "any" mode, hasImageFiles should not be called
      expect(hasImageFiles).not.toHaveBeenCalled();
    });

    it("should update handlers when onFiles changes", () => {
      const onFiles1 = vi.fn();
      const onFiles2 = vi.fn();
      const { result, rerender } = renderHook(
        ({ onFiles }) => useDragAndDrop({ onFiles, mode: "any" }),
        { initialProps: { onFiles: onFiles1 } },
      );

      const textFile = new File(["text"], "test.txt", { type: "text/plain" });
      const mockEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: {
          files: [textFile],
        },
      } as any;

      act(() => {
        result.current.handleDrop(mockEvent);
      });

      expect(onFiles1).toHaveBeenCalledWith([textFile]);

      rerender({ onFiles: onFiles2 });

      act(() => {
        result.current.handleDrop(mockEvent);
      });

      expect(onFiles2).toHaveBeenCalledWith([textFile]);
      expect(onFiles1).toHaveBeenCalledTimes(1);
    });
  });

  describe("edge cases", () => {
    it("should handle rapid drag over/drag leave cycles", () => {
      const onFiles = vi.fn();
      const { result } = renderHook(() =>
        useDragAndDrop({ onFiles, mode: "images" }),
      );

      const dragOverEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: {},
      } as any;

      const dragLeaveEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as any;

      vi.mocked(hasImageFiles).mockReturnValue(true);

      for (let i = 0; i < 10; i++) {
        act(() => {
          result.current.handleDragOver(dragOverEvent);
        });
        expect(result.current.isDragOver).toBe(true);

        act(() => {
          result.current.handleDragLeave(dragLeaveEvent);
        });
        expect(result.current.isDragOver).toBe(false);
      }
    });

    it("should handle drop without prior drag over", () => {
      const onFiles = vi.fn();
      const { result } = renderHook(() =>
        useDragAndDrop({ onFiles, mode: "images" }),
      );

      const imageFile = new File(["image"], "test.png", { type: "image/png" });
      const mockEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: {},
      } as any;

      vi.mocked(extractImageFiles).mockReturnValue([imageFile]);

      act(() => {
        result.current.handleDrop(mockEvent);
      });

      expect(onFiles).toHaveBeenCalledWith([imageFile]);
      expect(result.current.isDragOver).toBe(false);
    });

    it("should handle empty FileList", () => {
      const onFiles = vi.fn();
      const { result } = renderHook(() =>
        useDragAndDrop({ onFiles, mode: "any" }),
      );

      const mockEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: {
          files: [],
        },
      } as any;

      act(() => {
        result.current.handleDrop(mockEvent);
      });

      expect(onFiles).not.toHaveBeenCalled();
    });

    it("should handle dataTransfer with undefined files", () => {
      const onFiles = vi.fn();
      const { result } = renderHook(() =>
        useDragAndDrop({ onFiles, mode: "any" }),
      );

      const mockEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: {
          files: undefined,
        },
      } as any;

      act(() => {
        result.current.handleDrop(mockEvent);
      });

      expect(onFiles).not.toHaveBeenCalled();
    });
  });
});
