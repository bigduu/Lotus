import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { useMessageInputHandlers } from "../useMessageInputHandlers";
import type { ImageFile } from "../../../utils/imageUtils";

// Mock console.error
global.console = {
  ...console,
  error: vi.fn(),
};

// Mock requestAnimationFrame
const mockRaf = vi.fn((callback: FrameRequestCallback) => {
  callback(0);
  return 0;
});
global.requestAnimationFrame = mockRaf;

describe("useMessageInputHandlers", () => {
  let mockProps: {
    value: string;
    images: ImageFile[];
    isStreaming: boolean;
    disabled: boolean;
    isWorkflowSelectorVisible: boolean;
    onChange: ReturnType<typeof vi.fn>;
    onSubmit: ReturnType<typeof vi.fn>;
    onRetry?: ReturnType<typeof vi.fn>;
    onHistoryNavigate?: ReturnType<typeof vi.fn>;
    validateMessage?: ReturnType<typeof vi.fn>;
    isOverCharLimit: boolean;
    maxCharCount?: number;
    messageApi: { error: ReturnType<typeof vi.fn> };
    clearImages: ReturnType<typeof vi.fn>;
    textAreaRef: React.RefObject<TextAreaRef>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRaf.mockClear();
  });

  describe("handleSubmit", () => {
    it("should submit with text content", () => {
      const onSubmit = vi.fn();
      const onChange = vi.fn();
      const clearImages = vi.fn();
      const messageApi = { error: vi.fn() };
      const textAreaRef = { current: null };

      const { result } = renderHook(() =>
        useMessageInputHandlers({
          value: "  Hello World  ",
          images: [],
          isStreaming: false,
          disabled: false,
          isWorkflowSelectorVisible: false,
          onChange,
          onSubmit,
          isOverCharLimit: false,
          messageApi,
          clearImages,
          textAreaRef,
        }),
      );

      act(() => {
        result.current.handleSubmit();
      });

      expect(onSubmit).toHaveBeenCalledWith("Hello World", undefined);
      expect(clearImages).toHaveBeenCalled();
    });

    it("should submit with images", () => {
      const onSubmit = vi.fn();
      const onChange = vi.fn();
      const clearImages = vi.fn();
      const messageApi = { error: vi.fn() };
      const textAreaRef = { current: null };
      const images: ImageFile[] = [
        {
          id: "1",
          file: new File([""], "test.jpg", { type: "image/jpeg" }),
          preview: "data:image/jpeg;base64,test",
        },
      ];

      const { result } = renderHook(() =>
        useMessageInputHandlers({
          value: "Check this image",
          images,
          isStreaming: false,
          disabled: false,
          isWorkflowSelectorVisible: false,
          onChange,
          onSubmit,
          isOverCharLimit: false,
          messageApi,
          clearImages,
          textAreaRef,
        }),
      );

      act(() => {
        result.current.handleSubmit();
      });

      expect(onSubmit).toHaveBeenCalledWith("Check this image", images);
      expect(clearImages).toHaveBeenCalled();
    });

    it("should submit with only images (no text)", () => {
      const onSubmit = vi.fn();
      const clearImages = vi.fn();
      const messageApi = { error: vi.fn() };
      const textAreaRef = { current: null };
      const images: ImageFile[] = [
        {
          id: "1",
          file: new File([""], "test.jpg", { type: "image/jpeg" }),
          preview: "data:image/jpeg;base64,test",
        },
      ];

      const { result } = renderHook(() =>
        useMessageInputHandlers({
          value: "",
          images,
          isStreaming: false,
          disabled: false,
          isWorkflowSelectorVisible: false,
          onChange: vi.fn(),
          onSubmit,
          isOverCharLimit: false,
          messageApi,
          clearImages,
          textAreaRef,
        }),
      );

      act(() => {
        result.current.handleSubmit();
      });

      expect(onSubmit).toHaveBeenCalledWith("", images);
    });

    it("should not submit when content is empty and no images", () => {
      const onSubmit = vi.fn();
      const messageApi = { error: vi.fn() };
      const clearImages = vi.fn();
      const textAreaRef = { current: null };

      const { result } = renderHook(() =>
        useMessageInputHandlers({
          value: "   ",
          images: [],
          isStreaming: false,
          disabled: false,
          isWorkflowSelectorVisible: false,
          onChange: vi.fn(),
          onSubmit,
          isOverCharLimit: false,
          messageApi,
          clearImages,
          textAreaRef,
        }),
      );

      act(() => {
        result.current.handleSubmit();
      });

      expect(onSubmit).not.toHaveBeenCalled();
      expect(clearImages).not.toHaveBeenCalled();
    });

    it("should not submit when streaming", () => {
      const onSubmit = vi.fn();
      const messageApi = { error: vi.fn() };
      const clearImages = vi.fn();
      const textAreaRef = { current: null };

      const { result } = renderHook(() =>
        useMessageInputHandlers({
          value: "test",
          images: [],
          isStreaming: true,
          disabled: false,
          isWorkflowSelectorVisible: false,
          onChange: vi.fn(),
          onSubmit,
          isOverCharLimit: false,
          messageApi,
          clearImages,
          textAreaRef,
        }),
      );

      act(() => {
        result.current.handleSubmit();
      });

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("should not submit when disabled", () => {
      const onSubmit = vi.fn();
      const messageApi = { error: vi.fn() };
      const clearImages = vi.fn();
      const textAreaRef = { current: null };

      const { result } = renderHook(() =>
        useMessageInputHandlers({
          value: "test",
          images: [],
          isStreaming: false,
          disabled: true,
          isWorkflowSelectorVisible: false,
          onChange: vi.fn(),
          onSubmit,
          isOverCharLimit: false,
          messageApi,
          clearImages,
          textAreaRef,
        }),
      );

      act(() => {
        result.current.handleSubmit();
      });

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("should show error when over character limit", () => {
      const onSubmit = vi.fn();
      const messageApi = { error: vi.fn() };
      const clearImages = vi.fn();
      const textAreaRef = { current: null };

      const { result } = renderHook(() =>
        useMessageInputHandlers({
          value: "test",
          images: [],
          isStreaming: false,
          disabled: false,
          isWorkflowSelectorVisible: false,
          onChange: vi.fn(),
          onSubmit,
          isOverCharLimit: true,
          maxCharCount: 5000,
          messageApi,
          clearImages,
          textAreaRef,
        }),
      );

      act(() => {
        result.current.handleSubmit();
      });

      expect(messageApi.error).toHaveBeenCalledWith(
        "Message exceeds the maximum length of 5,000 characters.",
      );
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("should show error with 'configured' label when maxCharCount is undefined", () => {
      const onSubmit = vi.fn();
      const messageApi = { error: vi.fn() };
      const clearImages = vi.fn();
      const textAreaRef = { current: null };

      const { result } = renderHook(() =>
        useMessageInputHandlers({
          value: "test",
          images: [],
          isStreaming: false,
          disabled: false,
          isWorkflowSelectorVisible: false,
          onChange: vi.fn(),
          onSubmit,
          isOverCharLimit: true,
          maxCharCount: undefined,
          messageApi,
          clearImages,
          textAreaRef,
        }),
      );

      act(() => {
        result.current.handleSubmit();
      });

      expect(messageApi.error).toHaveBeenCalledWith(
        "Message exceeds the maximum length of configured characters.",
      );
    });

    it("should validate message with custom validator", () => {
      const onSubmit = vi.fn();
      const messageApi = { error: vi.fn() };
      const clearImages = vi.fn();
      const textAreaRef = { current: null };
      const validateMessage = vi.fn().mockReturnValue({
        isValid: false,
        errorMessage: "Invalid format",
      });

      const { result } = renderHook(() =>
        useMessageInputHandlers({
          value: "test",
          images: [],
          isStreaming: false,
          disabled: false,
          isWorkflowSelectorVisible: false,
          onChange: vi.fn(),
          onSubmit,
          isOverCharLimit: false,
          messageApi,
          clearImages,
          textAreaRef,
          validateMessage,
        }),
      );

      act(() => {
        result.current.handleSubmit();
      });

      expect(validateMessage).toHaveBeenCalledWith("test");
      expect(messageApi.error).toHaveBeenCalledWith("Invalid format");
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("should use default error message when validation fails without custom message", () => {
      const onSubmit = vi.fn();
      const messageApi = { error: vi.fn() };
      const clearImages = vi.fn();
      const textAreaRef = { current: null };
      const validateMessage = vi.fn().mockReturnValue({ isValid: false });

      const { result } = renderHook(() =>
        useMessageInputHandlers({
          value: "test",
          images: [],
          isStreaming: false,
          disabled: false,
          isWorkflowSelectorVisible: false,
          onChange: vi.fn(),
          onSubmit,
          isOverCharLimit: false,
          messageApi,
          clearImages,
          textAreaRef,
          validateMessage,
        }),
      );

      act(() => {
        result.current.handleSubmit();
      });

      expect(messageApi.error).toHaveBeenCalledWith("Message format is incorrect");
    });

    it("should submit when validation passes", () => {
      const onSubmit = vi.fn();
      const clearImages = vi.fn();
      const messageApi = { error: vi.fn() };
      const textAreaRef = { current: null };
      const validateMessage = vi.fn().mockReturnValue({ isValid: true });

      const { result } = renderHook(() =>
        useMessageInputHandlers({
          value: "test",
          images: [],
          isStreaming: false,
          disabled: false,
          isWorkflowSelectorVisible: false,
          onChange: vi.fn(),
          onSubmit,
          isOverCharLimit: false,
          messageApi,
          clearImages,
          textAreaRef,
          validateMessage,
        }),
      );

      act(() => {
        result.current.handleSubmit();
      });

      expect(onSubmit).toHaveBeenCalledWith("test", undefined);
    });
  });

  describe("handleKeyDown", () => {
    it("should submit on Enter key", () => {
      const onSubmit = vi.fn();
      const clearImages = vi.fn();
      const messageApi = { error: vi.fn() };
      const textAreaRef = { current: null };

      const { result } = renderHook(() =>
        useMessageInputHandlers({
          value: "test",
          images: [],
          isStreaming: false,
          disabled: false,
          isWorkflowSelectorVisible: false,
          onChange: vi.fn(),
          onSubmit,
          isOverCharLimit: false,
          messageApi,
          clearImages,
          textAreaRef,
        }),
      );

      const event = {
        key: "Enter",
        shiftKey: false,
        preventDefault: vi.fn(),
      } as any;

      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(event.preventDefault).toHaveBeenCalled();
      expect(onSubmit).toHaveBeenCalled();
    });

    it("should not submit on Shift+Enter", () => {
      const onSubmit = vi.fn();
      const messageApi = { error: vi.fn() };
      const textAreaRef = { current: null };

      const { result } = renderHook(() =>
        useMessageInputHandlers({
          value: "test",
          images: [],
          isStreaming: false,
          disabled: false,
          isWorkflowSelectorVisible: false,
          onChange: vi.fn(),
          onSubmit,
          isOverCharLimit: false,
          messageApi,
          clearImages: vi.fn(),
          textAreaRef,
        }),
      );

      const event = {
        key: "Enter",
        shiftKey: true,
        preventDefault: vi.fn(),
      } as any;

      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("should not submit when workflow selector is visible", () => {
      const onSubmit = vi.fn();
      const messageApi = { error: vi.fn() };
      const textAreaRef = { current: null };

      const { result } = renderHook(() =>
        useMessageInputHandlers({
          value: "test",
          images: [],
          isStreaming: false,
          disabled: false,
          isWorkflowSelectorVisible: true,
          onChange: vi.fn(),
          onSubmit,
          isOverCharLimit: false,
          messageApi,
          clearImages: vi.fn(),
          textAreaRef,
        }),
      );

      const event = {
        key: "Enter",
        shiftKey: false,
        preventDefault: vi.fn(),
      } as any;

      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("should navigate history with ArrowUp", () => {
      const onChange = vi.fn();
      const onHistoryNavigate = vi.fn().mockReturnValue("previous value");
      const messageApi = { error: vi.fn() };
      const mockTextArea = {
        setSelectionRange: vi.fn(),
      };
      const textAreaRef = {
        current: {
          resizableTextArea: {
            textArea: mockTextArea,
          },
        } as any,
      };

      const { result } = renderHook(() =>
        useMessageInputHandlers({
          value: "current value",
          images: [],
          isStreaming: false,
          disabled: false,
          isWorkflowSelectorVisible: false,
          onChange,
          onSubmit: vi.fn(),
          isOverCharLimit: false,
          messageApi,
          clearImages: vi.fn(),
          textAreaRef,
          onHistoryNavigate,
        }),
      );

      const event = {
        key: "ArrowUp",
        shiftKey: false,
        preventDefault: vi.fn(),
      } as any;

      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(onHistoryNavigate).toHaveBeenCalledWith("previous", "current value");
      expect(event.preventDefault).toHaveBeenCalled();
      expect(onChange).toHaveBeenCalledWith("previous value");
      expect(mockTextArea.setSelectionRange).toHaveBeenCalledWith(14, 14);
    });

    it("should navigate history with ArrowDown", () => {
      const onChange = vi.fn();
      const onHistoryNavigate = vi.fn().mockReturnValue("next value");
      const messageApi = { error: vi.fn() };
      const mockTextArea = {
        setSelectionRange: vi.fn(),
      };
      const textAreaRef = {
        current: {
          resizableTextArea: {
            textArea: mockTextArea,
          },
        } as any,
      };

      const { result } = renderHook(() =>
        useMessageInputHandlers({
          value: "current value",
          images: [],
          isStreaming: false,
          disabled: false,
          isWorkflowSelectorVisible: false,
          onChange,
          onSubmit: vi.fn(),
          isOverCharLimit: false,
          messageApi,
          clearImages: vi.fn(),
          textAreaRef,
          onHistoryNavigate,
        }),
      );

      const event = {
        key: "ArrowDown",
        shiftKey: false,
        preventDefault: vi.fn(),
      } as any;

      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(onHistoryNavigate).toHaveBeenCalledWith("next", "current value");
      expect(event.preventDefault).toHaveBeenCalled();
      expect(onChange).toHaveBeenCalledWith("next value");
    });

    it("should not navigate history when disabled", () => {
      const onHistoryNavigate = vi.fn();
      const messageApi = { error: vi.fn() };
      const textAreaRef = { current: null };

      const { result } = renderHook(() =>
        useMessageInputHandlers({
          value: "test",
          images: [],
          isStreaming: false,
          disabled: true,
          isWorkflowSelectorVisible: false,
          onChange: vi.fn(),
          onSubmit: vi.fn(),
          isOverCharLimit: false,
          messageApi,
          clearImages: vi.fn(),
          textAreaRef,
          onHistoryNavigate,
        }),
      );

      const event = {
        key: "ArrowUp",
        shiftKey: false,
        preventDefault: vi.fn(),
      } as any;

      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(onHistoryNavigate).not.toHaveBeenCalled();
    });

    it("should not navigate history when streaming", () => {
      const onHistoryNavigate = vi.fn();
      const messageApi = { error: vi.fn() };
      const textAreaRef = { current: null };

      const { result } = renderHook(() =>
        useMessageInputHandlers({
          value: "test",
          images: [],
          isStreaming: true,
          disabled: false,
          isWorkflowSelectorVisible: false,
          onChange: vi.fn(),
          onSubmit: vi.fn(),
          isOverCharLimit: false,
          messageApi,
          clearImages: vi.fn(),
          textAreaRef,
          onHistoryNavigate,
        }),
      );

      const event = {
        key: "ArrowUp",
        shiftKey: false,
        preventDefault: vi.fn(),
      } as any;

      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(onHistoryNavigate).not.toHaveBeenCalled();
    });

    it("should not navigate history when Shift is pressed", () => {
      const onHistoryNavigate = vi.fn();
      const messageApi = { error: vi.fn() };
      const textAreaRef = { current: null };

      const { result } = renderHook(() =>
        useMessageInputHandlers({
          value: "test",
          images: [],
          isStreaming: false,
          disabled: false,
          isWorkflowSelectorVisible: false,
          onChange: vi.fn(),
          onSubmit: vi.fn(),
          isOverCharLimit: false,
          messageApi,
          clearImages: vi.fn(),
          textAreaRef,
          onHistoryNavigate,
        }),
      );

      const event = {
        key: "ArrowUp",
        shiftKey: true,
        preventDefault: vi.fn(),
      } as any;

      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(onHistoryNavigate).not.toHaveBeenCalled();
    });

    it("should not navigate history when onHistoryNavigate returns null", () => {
      const onChange = vi.fn();
      const onHistoryNavigate = vi.fn().mockReturnValue(null);
      const messageApi = { error: vi.fn() };
      const textAreaRef = { current: null };

      const { result } = renderHook(() =>
        useMessageInputHandlers({
          value: "test",
          images: [],
          isStreaming: false,
          disabled: false,
          isWorkflowSelectorVisible: false,
          onChange,
          onSubmit: vi.fn(),
          isOverCharLimit: false,
          messageApi,
          clearImages: vi.fn(),
          textAreaRef,
          onHistoryNavigate,
        }),
      );

      const event = {
        key: "ArrowUp",
        shiftKey: false,
        preventDefault: vi.fn(),
      } as any;

      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
    });

    it("should not navigate history when onHistoryNavigate returns undefined", () => {
      const onChange = vi.fn();
      const onHistoryNavigate = vi.fn().mockReturnValue(undefined);
      const messageApi = { error: vi.fn() };
      const textAreaRef = { current: null };

      const { result } = renderHook(() =>
        useMessageInputHandlers({
          value: "test",
          images: [],
          isStreaming: false,
          disabled: false,
          isWorkflowSelectorVisible: false,
          onChange,
          onSubmit: vi.fn(),
          isOverCharLimit: false,
          messageApi,
          clearImages: vi.fn(),
          textAreaRef,
          onHistoryNavigate,
        }),
      );

      const event = {
        key: "ArrowUp",
        shiftKey: false,
        preventDefault: vi.fn(),
      } as any;

      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
    });

    it("should handle textAreaRef with missing resizableTextArea", () => {
      const onChange = vi.fn();
      const onHistoryNavigate = vi.fn().mockReturnValue("previous");
      const messageApi = { error: vi.fn() };
      const textAreaRef = {
        current: {} as any,
      };

      const { result } = renderHook(() =>
        useMessageInputHandlers({
          value: "test",
          images: [],
          isStreaming: false,
          disabled: false,
          isWorkflowSelectorVisible: false,
          onChange,
          onSubmit: vi.fn(),
          isOverCharLimit: false,
          messageApi,
          clearImages: vi.fn(),
          textAreaRef,
          onHistoryNavigate,
        }),
      );

      const event = {
        key: "ArrowUp",
        shiftKey: false,
        preventDefault: vi.fn(),
      } as any;

      act(() => {
        result.current.handleKeyDown(event);
      });

      // Should still call onChange even if textArea is not available
      expect(onChange).toHaveBeenCalledWith("previous");
    });
  });

  describe("handleRetry", () => {
    it("should call onRetry when not streaming or disabled", () => {
      const onRetry = vi.fn();
      const messageApi = { error: vi.fn() };
      const textAreaRef = { current: null };

      const { result } = renderHook(() =>
        useMessageInputHandlers({
          value: "",
          images: [],
          isStreaming: false,
          disabled: false,
          isWorkflowSelectorVisible: false,
          onChange: vi.fn(),
          onSubmit: vi.fn(),
          isOverCharLimit: false,
          messageApi,
          clearImages: vi.fn(),
          textAreaRef,
          onRetry,
        }),
      );

      act(() => {
        result.current.handleRetry();
      });

      expect(onRetry).toHaveBeenCalledWith("regenerate");
    });

    it("should not call onRetry when streaming", () => {
      const onRetry = vi.fn();
      const messageApi = { error: vi.fn() };
      const textAreaRef = { current: null };

      const { result } = renderHook(() =>
        useMessageInputHandlers({
          value: "",
          images: [],
          isStreaming: true,
          disabled: false,
          isWorkflowSelectorVisible: false,
          onChange: vi.fn(),
          onSubmit: vi.fn(),
          isOverCharLimit: false,
          messageApi,
          clearImages: vi.fn(),
          textAreaRef,
          onRetry,
        }),
      );

      act(() => {
        result.current.handleRetry();
      });

      expect(onRetry).not.toHaveBeenCalled();
    });

    it("should not call onRetry when disabled", () => {
      const onRetry = vi.fn();
      const messageApi = { error: vi.fn() };
      const textAreaRef = { current: null };

      const { result } = renderHook(() =>
        useMessageInputHandlers({
          value: "",
          images: [],
          isStreaming: false,
          disabled: true,
          isWorkflowSelectorVisible: false,
          onChange: vi.fn(),
          onSubmit: vi.fn(),
          isOverCharLimit: false,
          messageApi,
          clearImages: vi.fn(),
          textAreaRef,
          onRetry,
        }),
      );

      act(() => {
        result.current.handleRetry();
      });

      expect(onRetry).not.toHaveBeenCalled();
    });

    it("should not call onRetry when onRetry is undefined", () => {
      const messageApi = { error: vi.fn() };
      const textAreaRef = { current: null };

      const { result } = renderHook(() =>
        useMessageInputHandlers({
          value: "",
          images: [],
          isStreaming: false,
          disabled: false,
          isWorkflowSelectorVisible: false,
          onChange: vi.fn(),
          onSubmit: vi.fn(),
          isOverCharLimit: false,
          messageApi,
          clearImages: vi.fn(),
          textAreaRef,
          onRetry: undefined,
        }),
      );

      act(() => {
        result.current.handleRetry();
      });

      // Should not throw error
    });
  });
});
