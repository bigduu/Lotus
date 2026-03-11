import { describe, expect, it } from "vitest";

import {
  createContentPreview,
  createCompactPreview,
  formatResultContent,
  getFileChangeDiffStats,
  getStatusColor,
  parseFileChangeResultPayload,
  parseUnifiedDiffLines,
  safeStringify,
  shouldCollapseContent,
} from "../resultFormatters";

describe("formatResultContent", () => {
  it("parses valid JSON payloads", () => {
    const payload = JSON.stringify({ hello: "world", count: 1 });
    const result = formatResultContent(payload);

    expect(result.isJson).toBe(true);
    expect(result.formattedText).toContain('\n  "hello": "world"');
    expect(result.parsedJson).toEqual({ hello: "world", count: 1 });
  });

  it("returns plain text when JSON parsing fails", () => {
    const payload = "{not: 'json'}";
    const result = formatResultContent(payload);

    expect(result.isJson).toBe(false);
    expect(result.formattedText).toBe(payload);
  });

  it("returns empty metadata for blank content", () => {
    const result = formatResultContent("   ");

    expect(result.isJson).toBe(false);
    expect(result.formattedText).toBe("");
  });
});

describe("shouldCollapseContent", () => {
  it("collapses when content exceeds default limits", () => {
    const longContent = Array.from(
      { length: 30 },
      (_, idx) => `line-${idx}`,
    ).join("\n");
    expect(shouldCollapseContent(longContent)).toBe(true);
  });

  it("honours custom collapse thresholds", () => {
    const content = "a".repeat(100);
    expect(shouldCollapseContent(content, { maxCharacters: 50 })).toBe(true);
    expect(shouldCollapseContent(content, { maxCharacters: 120 })).toBe(false);
  });
});

describe("createContentPreview", () => {
  it("returns full text when under limit", () => {
    const preview = createContentPreview("short text", 20);
    expect(preview.preview).toBe("short text");
    expect(preview.isTruncated).toBe(false);
  });

  it("truncates long content with ellipsis", () => {
    const preview = createContentPreview("a".repeat(100), 10);
    expect(preview.isTruncated).toBe(true);
    expect(preview.preview.endsWith("…")).toBe(true);
    expect(preview.preview.length).toBeLessThanOrEqual(11);
  });
});

describe("getStatusColor", () => {
  it("maps statuses to semantic colors", () => {
    expect(getStatusColor("success")).toBe("green");
    expect(getStatusColor("error")).toBe("red");
    expect(getStatusColor("warning")).toBe("orange");
  });
});

describe("safeStringify", () => {
  it("returns original string values", () => {
    expect(safeStringify("plain")).toBe("plain");
  });

  it("stringifies objects with spacing", () => {
    const value = { foo: "bar" };
    expect(safeStringify(value, 2)).toBe('{\n  "foo": "bar"\n}');
  });

  it("falls back to String() when JSON.stringify throws", () => {
    const circular: any = {};
    circular.self = circular;

    expect(safeStringify(circular)).toBe("[object Object]");
  });
});

describe("parseFileChangeResultPayload", () => {
  it("parses checkpoint payload with unified diff", () => {
    const payload = JSON.stringify({
      operation: "Edit",
      message: "Edited file: /tmp/demo.ts",
      file_path: "/tmp/demo.ts",
      workspace: "/tmp",
      checkpoint: {
        created: true,
        path: "/tmp/checkpoint/demo.checkpoint",
      },
      diff: {
        unified: "--- a/demo.ts\n+++ b/demo.ts\n@@ -1,1 +1,1 @@\n-console.log('a')\n+console.log('b')",
        truncated: false,
      },
    });

    const parsed = parseFileChangeResultPayload(payload);
    expect(parsed).not.toBeNull();
    expect(parsed?.operation).toBe("Edit");
    expect(parsed?.file_path).toBe("/tmp/demo.ts");
    expect(parsed?.checkpoint?.created).toBe(true);
    expect(parsed?.diff.unified).toContain("@@ -1,1 +1,1 @@");
  });

  it("returns null for non-file-change payload", () => {
    const payload = JSON.stringify({ hello: "world" });
    expect(parseFileChangeResultPayload(payload)).toBeNull();
  });
});

describe("parseUnifiedDiffLines", () => {
  it("classifies add/remove/modified lines correctly", () => {
    const lines = parseUnifiedDiffLines(
      [
        "--- a/demo.ts",
        "+++ b/demo.ts",
        "@@ -1,2 +1,3 @@",
        " const a = 1;",
        "-const oldValue = a;",
        "+const newValue = a;",
        "@@ -5,0 +6,1 @@",
        "+const extra = true;",
        "@@ -9,1 +10,0 @@",
        "-const deleted = false;",
      ].join("\n"),
    );

    expect(lines.some((line) => line.kind === "meta")).toBe(true);
    expect(lines.some((line) => line.kind === "hunk")).toBe(true);
    expect(lines.some((line) => line.kind === "context")).toBe(true);
    expect(lines.some((line) => line.kind === "modified_remove")).toBe(true);
    expect(lines.some((line) => line.kind === "modified_add")).toBe(true);
    expect(lines.some((line) => line.kind === "add")).toBe(true);
    expect(lines.some((line) => line.kind === "remove")).toBe(true);
  });
});

describe("getFileChangeDiffStats", () => {
  it("uses unified diff stats as fallback when explicit counts are missing", () => {
    const payload = JSON.stringify({
      operation: "Edit",
      file_path: "/tmp/demo.ts",
      diff: {
        unified:
          "--- a/demo.ts\n+++ b/demo.ts\n@@ -1,2 +1,2 @@\n-const oldValue = 1;\n+const newValue = 1;\n+const added = true;",
      },
    });

    expect(getFileChangeDiffStats(payload)).toEqual({
      added: 2,
      removed: 1,
    });
  });

  it("prefers explicit added/removed counts when provided", () => {
    const payload = JSON.stringify({
      operation: "Edit",
      file_path: "/tmp/demo.ts",
      diff: {
        unified:
          "--- a/demo.ts\n+++ b/demo.ts\n@@ -1,1 +1,1 @@\n-const a = 1;\n+const a = 2;",
        added_lines: 8,
        removed_lines: 3,
      },
    });

    expect(getFileChangeDiffStats(payload)).toEqual({
      added: 8,
      removed: 3,
    });
  });
});

describe("createCompactPreview", () => {
  it("creates file-change specific preview", () => {
    const payload = JSON.stringify({
      operation: "Write",
      file_path: "/tmp/src/main.rs",
      diff: {
        unified: "--- a/main.rs\n+++ b/main.rs",
      },
    });

    const preview = createCompactPreview(payload);
    expect(preview).toContain("Write:");
    expect(preview).toContain("main.rs");
  });
});
