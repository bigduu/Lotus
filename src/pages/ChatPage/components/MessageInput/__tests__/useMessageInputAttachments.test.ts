import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useMessageInputAttachments } from "../useMessageInputAttachments";

const mockHandleImageFiles = vi.fn();
const mockHandleImagePreview = vi.fn();
const mockClearImages = vi.fn();
const mockSetImages = vi.fn();
const mockSetPreviewModalVisible = vi.fn();

const mockHandleDragOver = vi.fn();
const mockHandleDragLeave = vi.fn();
const mockHandleDrop = vi.fn();
const mockHandlePaste = vi.fn();

let capturedDragAndDropConfig: any;
let capturedPasteConfig: any;

vi.mock("../../../hooks/useImageHandler", () => ({
  useImageHandler: vi.fn(() => ({
    images: [],
    setImages: mockSetImages,
    previewModalVisible: false,
    setPreviewModalVisible: mockSetPreviewModalVisible,
    previewImageIndex: 0,
    handleImageFiles: mockHandleImageFiles,
    handleImagePreview: mockHandleImagePreview,
    clearImages: mockClearImages,
  })),
}));

vi.mock("../../../hooks/useDragAndDrop", () => ({
  useDragAndDrop: vi.fn((config: unknown) => {
    capturedDragAndDropConfig = config;
    return {
      isDragOver: false,
      handleDragOver: mockHandleDragOver,
      handleDragLeave: mockHandleDragLeave,
      handleDrop: mockHandleDrop,
    };
  }),
}));

vi.mock("../../../hooks/usePasteHandler", () => ({
  usePasteHandler: vi.fn((config: unknown) => {
    capturedPasteConfig = config;
    return { handlePaste: mockHandlePaste };
  }),
}));

vi.mock("../../../utils/fileUtils", () => ({
  separateImageFiles: vi.fn(),
  processFiles: vi.fn(),
}));

import { processFiles, separateImageFiles } from "../../../utils/fileUtils";

const createHook = (options?: {
  allowImages?: boolean;
  disabled?: boolean;
  onAttachmentsAdded?: (files: any[]) => void;
  messageApi?: { success: (content: string) => void; error: (content: string) => void };
}) => {
  const messageApi = options?.messageApi ?? {
    success: vi.fn(),
    error: vi.fn(),
  };

  const onAttachmentsAdded = options?.onAttachmentsAdded;
  const allowImages = options?.allowImages ?? true;

  const hook = renderHook(() =>
    useMessageInputAttachments({
      allowImages,
      disabled: options?.disabled,
      onAttachmentsAdded,
      messageApi,
    }),
  );

  return { ...hook, messageApi, onAttachmentsAdded };
};

describe("useMessageInputAttachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedDragAndDropConfig = undefined;
    capturedPasteConfig = undefined;
  });

  it("wires drag-and-drop and paste handlers", () => {
    const { result } = createHook({ allowImages: true });

    expect(capturedDragAndDropConfig.mode).toBe("any");
    expect(typeof capturedDragAndDropConfig.onFiles).toBe("function");
    expect(capturedPasteConfig.allowImages).toBe(true);
    expect(capturedPasteConfig.onImages).toBe(mockHandleImageFiles);

    expect(result.current.handlePaste).toBe(mockHandlePaste);
    expect(result.current.handleDragOver).toBe(mockHandleDragOver);
    expect(result.current.handleDragLeave).toBe(mockHandleDragLeave);
    expect(result.current.handleDrop).toBe(mockHandleDrop);
    expect(result.current.handleImageFiles).toBe(mockHandleImageFiles);
    expect(result.current.handleImagePreview).toBe(mockHandleImagePreview);
    expect(result.current.clearImages).toBe(mockClearImages);
  });

  it("ignores empty dropped files", async () => {
    createHook();

    await act(async () => {
      await capturedDragAndDropConfig.onFiles([]);
    });

    expect(separateImageFiles).not.toHaveBeenCalled();
    expect(mockHandleImageFiles).not.toHaveBeenCalled();
    expect(processFiles).not.toHaveBeenCalled();
  });

  it("freezes every attachment ingestion path while the composer is disabled", async () => {
    const file = new File(["image"], "pending.png", { type: "image/png" });
    const onAttachmentsAdded = vi.fn();
    const { result } = createHook({ disabled: true, onAttachmentsAdded });

    expect(capturedPasteConfig.allowImages).toBe(false);
    expect(capturedPasteConfig.onImages).toBeUndefined();
    expect(capturedPasteConfig.onAttachments).toBeUndefined();
    await act(async () => {
      await capturedDragAndDropConfig.onFiles([file]);
    });
    expect(separateImageFiles).not.toHaveBeenCalled();

    const inputTarget = {
      files: { 0: file, length: 1, item: () => file } as unknown as FileList,
      value: "pending",
    };
    act(() => {
      result.current.handleFileInputChange({ target: inputTarget } as any);
    });
    expect(mockHandleImageFiles).not.toHaveBeenCalled();
    expect(inputTarget.value).toBe("");
  });

  it("processes dropped image files and non-image attachments", async () => {
    const imageFile = new File(["image"], "a.png", { type: "image/png" });
    const textFile = new File(["text"], "note.txt", { type: "text/plain" });
    const processed = [{ path: "note.txt", content: "abc" }];
    const onAttachmentsAdded = vi.fn();
    const messageApi = { success: vi.fn(), error: vi.fn() };

    vi.mocked(separateImageFiles).mockReturnValue({
      images: [imageFile],
      others: [textFile],
    } as any);
    vi.mocked(processFiles).mockResolvedValue({
      processed,
      errors: ["failed.txt"],
    } as any);

    const { result } = createHook({ onAttachmentsAdded, messageApi });

    await act(async () => {
      await capturedDragAndDropConfig.onFiles([imageFile, textFile]);
    });

    expect(mockHandleImageFiles).toHaveBeenCalledWith([imageFile]);
    expect(processFiles).toHaveBeenCalledWith([textFile]);
    expect(onAttachmentsAdded).toHaveBeenCalledWith(processed);
    expect(messageApi.success).toHaveBeenCalledWith("Added 1 file(s)");
    expect(messageApi.error).toHaveBeenCalledWith("failed.txt");
    expect(result.current.isProcessingAttachments).toBe(false);
  });

  it("skips non-image processing when no onAttachmentsAdded callback is provided", async () => {
    const textFile = new File(["text"], "note.txt", { type: "text/plain" });
    const messageApi = { success: vi.fn(), error: vi.fn() };

    vi.mocked(separateImageFiles).mockReturnValue({
      images: [],
      others: [textFile],
    } as any);

    createHook({ messageApi, onAttachmentsAdded: undefined });

    await act(async () => {
      await capturedDragAndDropConfig.onFiles([textFile]);
    });

    expect(processFiles).not.toHaveBeenCalled();
    expect(messageApi.success).not.toHaveBeenCalled();
    expect(messageApi.error).not.toHaveBeenCalled();
  });

  it("does not emit success when processed attachment list is empty", async () => {
    const textFile = new File(["text"], "note.txt", { type: "text/plain" });
    const onAttachmentsAdded = vi.fn();
    const messageApi = { success: vi.fn(), error: vi.fn() };

    vi.mocked(separateImageFiles).mockReturnValue({
      images: [],
      others: [textFile],
    } as any);
    vi.mocked(processFiles).mockResolvedValue({
      processed: [],
      errors: ["cannot parse"],
    } as any);

    createHook({ onAttachmentsAdded, messageApi });

    await act(async () => {
      await capturedDragAndDropConfig.onFiles([textFile]);
    });

    expect(onAttachmentsAdded).not.toHaveBeenCalled();
    expect(messageApi.success).not.toHaveBeenCalled();
    expect(messageApi.error).toHaveBeenCalledWith("cannot parse");
  });

  it("provides a paste attachment handler only when onAttachmentsAdded exists", async () => {
    createHook({ onAttachmentsAdded: undefined });
    expect(capturedPasteConfig.onAttachments).toBeUndefined();

    const onAttachmentsAdded = vi.fn();
    const messageApi = { success: vi.fn(), error: vi.fn() };
    const textFile = new File(["text"], "from-paste.txt", { type: "text/plain" });
    const processed = [{ path: "from-paste.txt", content: "hello" }];

    vi.mocked(processFiles).mockResolvedValue({
      processed,
      errors: ["warn"],
    } as any);

    createHook({ onAttachmentsAdded, messageApi });
    expect(typeof capturedPasteConfig.onAttachments).toBe("function");

    await act(async () => {
      await capturedPasteConfig.onAttachments([textFile]);
    });

    expect(processFiles).toHaveBeenCalledWith([textFile]);
    expect(onAttachmentsAdded).toHaveBeenCalledWith(processed);
    expect(messageApi.success).toHaveBeenCalledWith("Attached 1 file(s)");
    expect(messageApi.error).toHaveBeenCalledWith("warn");
  });

  it("toggles processing state while paste attachment processing is in-flight", async () => {
    const onAttachmentsAdded = vi.fn();

    let resolveProcess!: (value: { processed: any[]; errors: string[] }) => void;
    vi.mocked(processFiles).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveProcess = resolve as typeof resolveProcess;
        }) as any,
    );

    const { result } = createHook({ onAttachmentsAdded });
    const textFile = new File(["text"], "pending.txt", { type: "text/plain" });

    act(() => {
      void capturedPasteConfig.onAttachments([textFile]);
    });

    await waitFor(() => {
      expect(result.current.isProcessingAttachments).toBe(true);
    });

    resolveProcess({ processed: [], errors: [] });

    await waitFor(() => {
      expect(result.current.isProcessingAttachments).toBe(false);
    });
  });

  it("handles file input changes and always clears input value", () => {
    const { result } = createHook();
    const file = new File(["image"], "pick.png", { type: "image/png" });
    const withFilesTarget = {
      files: {
        0: file,
        length: 1,
        item: () => file,
      } as unknown as FileList,
      value: "non-empty",
    };

    act(() => {
      result.current.handleFileInputChange({ target: withFilesTarget } as any);
    });

    expect(mockHandleImageFiles).toHaveBeenCalledWith(withFilesTarget.files);
    expect(withFilesTarget.value).toBe("");

    const withoutFilesTarget = { files: null, value: "will-reset" };
    act(() => {
      result.current.handleFileInputChange({ target: withoutFilesTarget } as any);
    });

    expect(withoutFilesTarget.value).toBe("");
  });
});
