import { describe, expect, it } from "vitest";

import {
  FileReferenceInfo,
  WorkflowCommandInfo,
  getFileReferenceInfo,
  getInputHighlightSegments,
  getWorkflowCommandInfo,
} from "../inputHighlight";

describe("getInputHighlightSegments", () => {
  it("identifies workflow commands and file references", () => {
    const value = "/run-analysis project @src/index.ts continue";
    const segments = getInputHighlightSegments(value);

    expect(segments).toEqual([
      { text: "/run-analysis", type: "workflow" },
      { text: " project ", type: "text" },
      { text: "@src/index.ts", type: "file" },
      { text: " continue", type: "text" },
    ]);
  });

  it("returns a default segment for empty strings", () => {
    expect(getInputHighlightSegments("")).toEqual([{ text: "", type: "text" }]);
  });

  describe("workflow commands", () => {
    it("should identify workflow at start of string", () => {
      const segments = getInputHighlightSegments("/workflow");
      expect(segments).toEqual([{ text: "/workflow", type: "workflow" }]);
    });

    it("should identify workflow after whitespace", () => {
      const segments = getInputHighlightSegments("text /workflow more");
      expect(segments).toEqual([
        { text: "text ", type: "text" },
        { text: "/workflow", type: "workflow" },
        { text: " more", type: "text" },
      ]);
    });

    it("should not identify workflow without preceding whitespace", () => {
      const segments = getInputHighlightSegments("text/workflow");
      expect(segments).toEqual([{ text: "text/workflow", type: "text" }]);
    });

    it("should identify multiple workflows", () => {
      const segments = getInputHighlightSegments("/workflow1 /workflow2");
      expect(segments).toEqual([
        { text: "/workflow1", type: "workflow" },
        { text: " ", type: "text" },
        { text: "/workflow2", type: "workflow" },
      ]);
    });

    it("should treat slash followed by text as workflow if no whitespace", () => {
      const segments = getInputHighlightSegments("/workflow/not-standalone");
      // The implementation treats this as a single workflow token since there's no whitespace
      expect(segments).toEqual([{ text: "/workflow/not-standalone", type: "workflow" }]);
    });

    it("should identify workflow at end of string", () => {
      const segments = getInputHighlightSegments("text /workflow");
      expect(segments).toEqual([
        { text: "text ", type: "text" },
        { text: "/workflow", type: "workflow" },
      ]);
    });
  });

  describe("file references", () => {
    it("should identify file reference at start of string", () => {
      const segments = getInputHighlightSegments("@file");
      expect(segments).toEqual([{ text: "@file", type: "file" }]);
    });

    it("should identify file reference after whitespace", () => {
      const segments = getInputHighlightSegments("text @file more");
      expect(segments).toEqual([
        { text: "text ", type: "text" },
        { text: "@file", type: "file" },
        { text: " more", type: "text" },
      ]);
    });

    it("should not identify file reference without preceding whitespace", () => {
      const segments = getInputHighlightSegments("text@file");
      expect(segments).toEqual([{ text: "text@file", type: "text" }]);
    });

    it("should identify multiple file references", () => {
      const segments = getInputHighlightSegments("@file1 @file2");
      expect(segments).toEqual([
        { text: "@file1", type: "file" },
        { text: " ", type: "text" },
        { text: "@file2", type: "file" },
      ]);
    });

    it("should handle file paths with special characters", () => {
      const segments = getInputHighlightSegments("@src/utils/file.ts");
      expect(segments).toEqual([{ text: "@src/utils/file.ts", type: "file" }]);
    });

    it("should identify file reference at end of string", () => {
      const segments = getInputHighlightSegments("text @file");
      expect(segments).toEqual([
        { text: "text ", type: "text" },
        { text: "@file", type: "file" },
      ]);
    });
  });

  describe("mixed content", () => {
    it("should handle workflows and files together", () => {
      const segments = getInputHighlightSegments("/workflow @file text");
      expect(segments).toEqual([
        { text: "/workflow", type: "workflow" },
        { text: " ", type: "text" },
        { text: "@file", type: "file" },
        { text: " text", type: "text" },
      ]);
    });

    it("should handle consecutive triggers without whitespace", () => {
      const segments = getInputHighlightSegments("/workflow@file");
      // The implementation treats consecutive triggers as one token (no whitespace between)
      expect(segments).toEqual([{ text: "/workflow@file", type: "workflow" }]);
    });
  });

  describe("edge cases", () => {
    it("should handle only whitespace", () => {
      const segments = getInputHighlightSegments("   ");
      expect(segments).toEqual([{ text: "   ", type: "text" }]);
    });

    it("should handle only slash", () => {
      const segments = getInputHighlightSegments("/");
      expect(segments).toEqual([{ text: "/", type: "workflow" }]);
    });

    it("should handle only at sign", () => {
      const segments = getInputHighlightSegments("@");
      expect(segments).toEqual([{ text: "@", type: "file" }]);
    });

    it("should handle newlines", () => {
      const segments = getInputHighlightSegments("text\n/workflow\n@file");
      expect(segments).toEqual([
        { text: "text\n", type: "text" },
        { text: "/workflow", type: "workflow" },
        { text: "\n", type: "text" },
        { text: "@file", type: "file" },
      ]);
    });

    it("should handle tabs", () => {
      const segments = getInputHighlightSegments("text\t/workflow\t@file");
      expect(segments).toEqual([
        { text: "text\t", type: "text" },
        { text: "/workflow", type: "workflow" },
        { text: "\t", type: "text" },
        { text: "@file", type: "file" },
      ]);
    });
  });
});

describe("getWorkflowCommandInfo", () => {
  it("activates trigger when caret is after slash", () => {
    const info: WorkflowCommandInfo = getWorkflowCommandInfo("Run /deploy");
    expect(info.isTriggerActive).toBe(true);
    expect(info.command).toBe("deploy");
    expect(info.searchText).toBe("deploy");
  });

  it("resets trigger when whitespace follows command", () => {
    const info = getWorkflowCommandInfo("/deploy now");
    expect(info.isTriggerActive).toBe(false);
    expect(info.command).toBeNull();
  });

  describe("empty and null cases", () => {
    it("should return null for empty string", () => {
      const info = getWorkflowCommandInfo("");
      expect(info).toEqual({
        command: null,
        isTriggerActive: false,
        searchText: "",
      });
    });

    it("should return null for string without slash", () => {
      const info = getWorkflowCommandInfo("no command here");
      expect(info).toEqual({
        command: null,
        isTriggerActive: false,
        searchText: "",
      });
    });

    it("should return null for slash not at end", () => {
      const info = getWorkflowCommandInfo("/command with space");
      expect(info.command).toBeNull();
      expect(info.isTriggerActive).toBe(false);
    });
  });

  describe("command parsing", () => {
    it("should parse command with alphanumeric characters", () => {
      const info = getWorkflowCommandInfo("test /command123");
      expect(info.command).toBe("command123");
      expect(info.searchText).toBe("command123");
    });

    it("should parse command with underscores", () => {
      const info = getWorkflowCommandInfo("test /my_command");
      expect(info.command).toBe("my_command");
      expect(info.searchText).toBe("my_command");
    });

    it("should parse command with hyphens", () => {
      const info = getWorkflowCommandInfo("test /my-command");
      expect(info.command).toBe("my-command");
      expect(info.searchText).toBe("my-command");
    });

    it("should handle just slash", () => {
      const info = getWorkflowCommandInfo("/");
      // Regex matches "/" at end with empty command, but trigger is still active
      expect(info.command).toBe(null);
      expect(info.searchText).toBe("");
      expect(info.isTriggerActive).toBe(true);
    });

    it("should handle slash with nothing after", () => {
      const info = getWorkflowCommandInfo("text /");
      expect(info.command).toBe(null);
      expect(info.searchText).toBe("");
    });
  });

  describe("trigger activation", () => {
    it("should activate trigger at end of string", () => {
      const info = getWorkflowCommandInfo("/workflow");
      expect(info.isTriggerActive).toBe(true);
    });

    it("should match last slash pattern even when not standalone", () => {
      const info = getWorkflowCommandInfo("/workflow/not-triggered");
      // Regex matches the LAST "/not-triggered" pattern
      expect(info.command).toBe("not-triggered");
      expect(info.isTriggerActive).toBe(true);
    });

    it("should handle multiple slashes", () => {
      const info = getWorkflowCommandInfo("text /first /second");
      expect(info.command).toBe("second");
      expect(info.isTriggerActive).toBe(true);
    });
  });
});

describe("getFileReferenceInfo", () => {
  it("detects active file reference tokens", () => {
    const info: FileReferenceInfo = getFileReferenceInfo("Open @src/utils");
    expect(info.isTriggerActive).toBe(true);
    expect(info.searchText).toBe("src/utils");
    expect(info.tokenStart).toBe(5);
  });

  it("ignores tokens containing spaces", () => {
    const info = getFileReferenceInfo("@not valid");
    expect(info.isTriggerActive).toBe(false);
    expect(info.searchText).toBe("");
    expect(info.tokenStart).toBeNull();
  });

  describe("empty and null cases", () => {
    it("should return null for empty string", () => {
      const info = getFileReferenceInfo("");
      expect(info).toEqual({
        isTriggerActive: false,
        searchText: "",
        tokenStart: null,
      });
    });

    it("should return null for string without at sign", () => {
      const info = getFileReferenceInfo("no file reference here");
      expect(info).toEqual({
        isTriggerActive: false,
        searchText: "",
        tokenStart: null,
      });
    });
  });

  describe("file path parsing", () => {
    it("should parse file path with dots", () => {
      const info = getFileReferenceInfo("open @src/utils/file.ts");
      expect(info.searchText).toBe("src/utils/file.ts");
      expect(info.isTriggerActive).toBe(true);
    });

    it("should parse file path with hyphens and underscores", () => {
      const info = getFileReferenceInfo("@src/my-file_utils.ts");
      expect(info.searchText).toBe("src/my-file_utils.ts");
      expect(info.isTriggerActive).toBe(true);
    });

    it("should parse file path with forward slashes", () => {
      const info = getFileReferenceInfo("@path/to/file");
      expect(info.searchText).toBe("path/to/file");
      expect(info.tokenStart).toBe(0);
    });

    it("should parse file path with backslashes", () => {
      const info = getFileReferenceInfo("@path\\to\\file");
      expect(info.searchText).toBe("path\\to\\file");
    });

    it("should handle just at sign", () => {
      const info = getFileReferenceInfo("@");
      expect(info.searchText).toBe("");
      expect(info.isTriggerActive).toBe(true);
      expect(info.tokenStart).toBe(0);
    });
  });

  describe("trigger activation", () => {
    it("should activate trigger at end of string", () => {
      const info = getFileReferenceInfo("@file");
      expect(info.isTriggerActive).toBe(true);
    });

    it("should not activate when contains space", () => {
      const info = getFileReferenceInfo("@file path");
      expect(info.isTriggerActive).toBe(false);
    });

    it("should handle multiple at signs", () => {
      const info = getFileReferenceInfo("text @first @second");
      expect(info.searchText).toBe("second");
      expect(info.isTriggerActive).toBe(true);
    });

    it("should correctly identify token start", () => {
      const info = getFileReferenceInfo("some text @file");
      expect(info.tokenStart).toBe(10);
    });
  });
});
