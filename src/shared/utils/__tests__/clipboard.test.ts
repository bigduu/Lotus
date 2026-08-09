import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyText } from "../clipboard";

describe("clipboard", () => {
  let clipboardWriteText: ReturnType<typeof vi.fn>;
  let execCommand: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock navigator.clipboard
    clipboardWriteText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: clipboardWriteText,
      },
      writable: true,
      configurable: true,
    });

    // Mock document.execCommand
    execCommand = vi.fn();
    document.execCommand = execCommand;

    // Mock document.body
    if (!document.body) {
      document.body = document.createElement("body");
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("copyWithNavigatorClipboard", () => {
    it("succeeds when navigator.clipboard.writeText is available", async () => {
      clipboardWriteText.mockResolvedValueOnce(undefined);

      await copyText("test text");

      expect(clipboardWriteText).toHaveBeenCalledWith("test text");
      expect(clipboardWriteText).toHaveBeenCalledTimes(1);
    });

    it("fails when navigator.clipboard is undefined", async () => {
      Object.defineProperty(navigator, "clipboard", {
        value: undefined,
        writable: true,
        configurable: true,
      });

      await expect(copyText("test")).rejects.toThrow("Clipboard copy failed: navigator");
    });

    it("fails when navigator.clipboard.writeText is undefined", async () => {
      Object.defineProperty(navigator, "clipboard", {
        value: {},
        writable: true,
        configurable: true,
      });

      await expect(copyText("test")).rejects.toThrow("Clipboard copy failed: navigator");
    });
  });

  describe("copyWithExecCommand (fallback)", () => {
    it("creates textarea and executes copy when navigator.clipboard fails", async () => {
      clipboardWriteText.mockRejectedValueOnce(new Error("navigator.clipboard failed"));
      execCommand.mockReturnValueOnce(true);

      await copyText("test text");

      expect(clipboardWriteText).toHaveBeenCalledWith("test text");
      expect(execCommand).toHaveBeenCalledWith("copy");
    });

    it("removes textarea from DOM after copy", async () => {
      clipboardWriteText.mockRejectedValueOnce(new Error("fail"));
      execCommand.mockReturnValueOnce(true);

      const initialChildCount = document.body.children.length;

      await copyText("test text");

      expect(document.body.children.length).toBe(initialChildCount);
    });

    it("sets textarea properties correctly", async () => {
      clipboardWriteText.mockRejectedValueOnce(new Error("fail"));
      execCommand.mockReturnValueOnce(true);

      const createElementSpy = vi.spyOn(document, "createElement");
      let createdTextarea: HTMLTextAreaElement | null = null;

      createElementSpy.mockImplementationOnce((tagName) => {
        const element = document.createElement(tagName);
        if (tagName === "textarea") {
          createdTextarea = element as HTMLTextAreaElement;
        }
        return element;
      });

      await copyText("test text");

      if (createdTextarea) {
        expect(createdTextarea.value).toBe("test text");
        expect(createdTextarea.getAttribute("readonly")).toBe("true");
        expect(createdTextarea.style.position).toBe("fixed");
        expect(createdTextarea.style.top).toBe("-9999px");
        expect(createdTextarea.style.left).toBe("-9999px");
        expect(createdTextarea.style.opacity).toBe("0");
      }

      createElementSpy.mockRestore();
    });

    it("fails when document.execCommand returns false", async () => {
      clipboardWriteText.mockRejectedValueOnce(new Error("navigator failed"));
      execCommand.mockReturnValueOnce(false);

      await expect(copyText("test")).rejects.toThrow("Clipboard copy failed: navigator");
    });
  });

  describe("copyText", () => {
    it("prefers navigator.clipboard over execCommand", async () => {
      clipboardWriteText.mockResolvedValueOnce(undefined);
      execCommand.mockReturnValueOnce(true);

      await copyText("test text");

      expect(clipboardWriteText).toHaveBeenCalledWith("test text");
      expect(execCommand).not.toHaveBeenCalled();
    });

    it("falls back to execCommand when navigator.clipboard fails", async () => {
      clipboardWriteText.mockRejectedValueOnce(new Error("clipboard API error"));
      execCommand.mockReturnValueOnce(true);

      await copyText("test text");

      expect(clipboardWriteText).toHaveBeenCalledWith("test text");
      expect(execCommand).toHaveBeenCalledWith("copy");
    });

    it("throws combined error when both methods fail", async () => {
      const navigatorError = new Error("navigator failed");

      clipboardWriteText.mockRejectedValueOnce(navigatorError);
      execCommand.mockReturnValueOnce(false);

      await expect(copyText("test")).rejects.toThrow(
        "Clipboard copy failed: navigator(navigator failed); fallback(document.execCommand('copy') returned false)",
      );
    });

    it("handles empty string", async () => {
      clipboardWriteText.mockResolvedValueOnce(undefined);

      await copyText("");

      expect(clipboardWriteText).toHaveBeenCalledWith("");
    });

    it("handles special characters", async () => {
      const specialText = '特殊字符 🚀 <script>alert("xss")</script>';
      clipboardWriteText.mockResolvedValueOnce(undefined);

      await copyText(specialText);

      expect(clipboardWriteText).toHaveBeenCalledWith(specialText);
    });

    it("handles very long text", async () => {
      const longText = "a".repeat(100000);
      clipboardWriteText.mockResolvedValueOnce(undefined);

      await copyText(longText);

      expect(clipboardWriteText).toHaveBeenCalledWith(longText);
    });

    it("handles newlines and multiline text", async () => {
      const multilineText = "line1\nline2\rline3\r\nline4";
      clipboardWriteText.mockResolvedValueOnce(undefined);

      await copyText(multilineText);

      expect(clipboardWriteText).toHaveBeenCalledWith(multilineText);
    });
  });

  describe("error handling", () => {
    it("includes both error messages when both fail", async () => {
      clipboardWriteText.mockRejectedValueOnce(new Error("first error"));
      execCommand.mockReturnValueOnce(false);

      try {
        await copyText("test");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("first error");
        expect((error as Error).message).toContain("document.execCommand('copy') returned false");
      }
    });

    it("handles non-Error exceptions from navigator.clipboard", async () => {
      clipboardWriteText.mockRejectedValueOnce("string error" as any);
      execCommand.mockReturnValueOnce(false);

      try {
        await copyText("test");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("string error");
      }
    });

    it("handles non-Error exceptions from execCommand", async () => {
      clipboardWriteText.mockRejectedValueOnce(new Error("navigator error"));
      execCommand.mockImplementation(() => {
        throw "exec error";
      });

      try {
        await copyText("test");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("navigator error");
        expect((error as Error).message).toContain("exec error");
      }
    });
  });
});
