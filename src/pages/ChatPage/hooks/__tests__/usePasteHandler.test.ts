import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePasteHandler } from "../usePasteHandler";

describe("usePasteHandler", () => {
  describe("initial state", () => {
    it("should return handlePaste function", () => {
      const onImages = vi.fn();
      const { result } = renderHook(() =>
        usePasteHandler({
          onImages,
          allowImages: true,
        }),
      );

      expect(typeof result.current.handlePaste).toBe("function");
    });
  });

  describe("image pasting", () => {
    it("should call onImages when images are pasted and allowImages is true", () => {
      const onImages = vi.fn();
      const { result } = renderHook(() =>
        usePasteHandler({
          onImages,
          allowImages: true,
        }),
      );

      const imageFile = new File(["image"], "test.png", { type: "image/png" });
      const clipboardData = {
        items: [
          {
            kind: "file",
            getAsFile: () => imageFile,
          },
        ],
      };

      const event = {
        clipboardData,
        preventDefault: vi.fn(),
      } as any;

      result.current.handlePaste(event);

      expect(onImages).toHaveBeenCalledTimes(1);
      expect(onImages).toHaveBeenCalledWith([imageFile]);
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it("should not call onImages when allowImages is false", () => {
      const onImages = vi.fn();
      const { result } = renderHook(() =>
        usePasteHandler({
          onImages,
          allowImages: false,
        }),
      );

      const imageFile = new File(["image"], "test.png", { type: "image/png" });
      const clipboardData = {
        items: [
          {
            kind: "file",
            getAsFile: () => imageFile,
          },
        ],
      };

      const event = {
        clipboardData,
        preventDefault: vi.fn(),
      } as any;

      result.current.handlePaste(event);

      expect(onImages).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it("should handle multiple images", () => {
      const onImages = vi.fn();
      const { result } = renderHook(() =>
        usePasteHandler({
          onImages,
          allowImages: true,
        }),
      );

      const image1 = new File(["image1"], "test1.png", { type: "image/png" });
      const image2 = new File(["image2"], "test2.jpg", { type: "image/jpeg" });
      const clipboardData = {
        items: [
          {
            kind: "file",
            getAsFile: () => image1,
          },
          {
            kind: "file",
            getAsFile: () => image2,
          },
        ],
      };

      const event = {
        clipboardData,
        preventDefault: vi.fn(),
      } as any;

      result.current.handlePaste(event);

      expect(onImages).toHaveBeenCalledWith([image1, image2]);
    });

    it("should handle different image types", () => {
      const onImages = vi.fn();
      const { result } = renderHook(() =>
        usePasteHandler({
          onImages,
          allowImages: true,
        }),
      );

      const png = new File([""], "test.png", { type: "image/png" });
      const jpg = new File([""], "test.jpg", { type: "image/jpeg" });
      const gif = new File([""], "test.gif", { type: "image/gif" });
      const webp = new File([""], "test.webp", { type: "image/webp" });

      const clipboardData = {
        items: [
          { kind: "file", getAsFile: () => png },
          { kind: "file", getAsFile: () => jpg },
          { kind: "file", getAsFile: () => gif },
          { kind: "file", getAsFile: () => webp },
        ],
      };

      const event = {
        clipboardData,
        preventDefault: vi.fn(),
      } as any;

      result.current.handlePaste(event);

      expect(onImages).toHaveBeenCalledWith([png, jpg, gif, webp]);
    });
  });

  describe("attachment pasting", () => {
    it("should call onAttachments when non-image files are pasted", () => {
      const onImages = vi.fn();
      const onAttachments = vi.fn();
      const { result } = renderHook(() =>
        usePasteHandler({
          onImages,
          onAttachments,
          allowImages: true,
        }),
      );

      const textFile = new File(["text"], "test.txt", { type: "text/plain" });
      const clipboardData = {
        items: [
          {
            kind: "file",
            getAsFile: () => textFile,
          },
        ],
      };

      const event = {
        clipboardData,
        preventDefault: vi.fn(),
      } as any;

      result.current.handlePaste(event);

      expect(onAttachments).toHaveBeenCalledTimes(1);
      expect(onAttachments).toHaveBeenCalledWith([textFile]);
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it("should not call onAttachments when callback is not provided", () => {
      const onImages = vi.fn();
      const { result } = renderHook(() =>
        usePasteHandler({
          onImages,
          allowImages: true,
        }),
      );

      const textFile = new File(["text"], "test.txt", { type: "text/plain" });
      const clipboardData = {
        items: [
          {
            kind: "file",
            getAsFile: () => textFile,
          },
        ],
      };

      const event = {
        clipboardData,
        preventDefault: vi.fn(),
      } as any;

      result.current.handlePaste(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it("should handle mixed file types", () => {
      const onImages = vi.fn();
      const onAttachments = vi.fn();
      const { result } = renderHook(() =>
        usePasteHandler({
          onImages,
          onAttachments,
          allowImages: true,
        }),
      );

      const image = new File([""], "test.png", { type: "image/png" });
      const text = new File(["text"], "test.txt", { type: "text/plain" });
      const pdf = new File(["pdf"], "test.pdf", { type: "application/pdf" });

      const clipboardData = {
        items: [
          { kind: "file", getAsFile: () => image },
          { kind: "file", getAsFile: () => text },
          { kind: "file", getAsFile: () => pdf },
        ],
      };

      const event = {
        clipboardData,
        preventDefault: vi.fn(),
      } as any;

      result.current.handlePaste(event);

      expect(onImages).toHaveBeenCalledWith([image]);
      expect(onAttachments).toHaveBeenCalledWith([text, pdf]);
    });
  });

  describe("edge cases", () => {
    it("should handle missing clipboardData", () => {
      const onImages = vi.fn();
      const { result } = renderHook(() =>
        usePasteHandler({
          onImages,
          allowImages: true,
        }),
      );

      const event = {} as any;

      result.current.handlePaste(event);

      expect(onImages).not.toHaveBeenCalled();
    });

    it("should handle null clipboardData", () => {
      const onImages = vi.fn();
      const { result } = renderHook(() =>
        usePasteHandler({
          onImages,
          allowImages: true,
        }),
      );

      const event = {
        clipboardData: null,
      } as any;

      result.current.handlePaste(event);

      expect(onImages).not.toHaveBeenCalled();
    });

    it("should handle empty items array", () => {
      const onImages = vi.fn();
      const { result } = renderHook(() =>
        usePasteHandler({
          onImages,
          allowImages: true,
        }),
      );

      const event = {
        clipboardData: { items: [] },
        preventDefault: vi.fn(),
      } as any;

      result.current.handlePaste(event);

      expect(onImages).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it("should skip non-file items", () => {
      const onImages = vi.fn();
      const onAttachments = vi.fn();
      const { result } = renderHook(() =>
        usePasteHandler({
          onImages,
          onAttachments,
          allowImages: true,
        }),
      );

      const event = {
        clipboardData: {
          items: [
            { kind: "string", getAsFile: () => null },
            { kind: "string", getAsFile: () => null },
          ],
        },
        preventDefault: vi.fn(),
      } as any;

      result.current.handlePaste(event);

      expect(onImages).not.toHaveBeenCalled();
      expect(onAttachments).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it("should handle file item with null getAsFile result", () => {
      const onImages = vi.fn();
      const { result } = renderHook(() =>
        usePasteHandler({
          onImages,
          allowImages: true,
        }),
      );

      const event = {
        clipboardData: {
          items: [
            {
              kind: "file",
              getAsFile: () => null,
            },
          ],
        },
        preventDefault: vi.fn(),
      } as any;

      result.current.handlePaste(event);

      expect(onImages).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe("callback stability", () => {
    it("should update handler when allowImages changes", () => {
      const onImages = vi.fn();
      const { result, rerender } = renderHook(
        ({ allowImages }) =>
          usePasteHandler({
            onImages,
            allowImages,
          }),
        { initialProps: { allowImages: true } },
      );

      const imageFile = new File(["image"], "test.png", { type: "image/png" });
      const event = {
        clipboardData: {
          items: [{ kind: "file", getAsFile: () => imageFile }],
        },
        preventDefault: vi.fn(),
      } as any;

      result.current.handlePaste(event);
      expect(onImages).toHaveBeenCalledTimes(1);

      rerender({ allowImages: false });

      result.current.handlePaste(event);
      expect(onImages).toHaveBeenCalledTimes(1); // Not called again
    });

    it("should update handler when onImages callback changes", () => {
      const onImages1 = vi.fn();
      const onImages2 = vi.fn();
      const { result, rerender } = renderHook(
        ({ onImages }) =>
          usePasteHandler({
            onImages,
            allowImages: true,
          }),
        { initialProps: { onImages: onImages1 } },
      );

      const imageFile = new File(["image"], "test.png", { type: "image/png" });
      const event = {
        clipboardData: {
          items: [{ kind: "file", getAsFile: () => imageFile }],
        },
        preventDefault: vi.fn(),
      } as any;

      result.current.handlePaste(event);
      expect(onImages1).toHaveBeenCalledTimes(1);

      rerender({ onImages: onImages2 });

      result.current.handlePaste(event);
      expect(onImages2).toHaveBeenCalledTimes(1);
      expect(onImages1).toHaveBeenCalledTimes(1); // Not called again
    });

    it("should update handler when onAttachments callback changes", () => {
      const onImages = vi.fn();
      const onAttachments1 = vi.fn();
      const onAttachments2 = vi.fn();
      const { result, rerender } = renderHook(
        ({ onAttachments }) =>
          usePasteHandler({
            onImages,
            onAttachments,
            allowImages: true,
          }),
        { initialProps: { onAttachments: onAttachments1 } },
      );

      const textFile = new File(["text"], "test.txt", { type: "text/plain" });
      const event = {
        clipboardData: {
          items: [{ kind: "file", getAsFile: () => textFile }],
        },
        preventDefault: vi.fn(),
      } as any;

      result.current.handlePaste(event);
      expect(onAttachments1).toHaveBeenCalledTimes(1);

      rerender({ onAttachments: onAttachments2 });

      result.current.handlePaste(event);
      expect(onAttachments2).toHaveBeenCalledTimes(1);
      expect(onAttachments1).toHaveBeenCalledTimes(1); // Not called again
    });
  });
});
