import { describe, expect, it } from "vitest";

import {
  createContentPreview,
  createCompactPreview,
  formatConclusionToolResultAsMarkdown,
  formatConclusionWithOptionsConclusionAsMarkdown,
  formatResultContent,
  getFileChangeDiffStats,
  getStatusColor,
  parseInteractiveQuestionToolResultPayload,
  isPermissionApprovalResult,
  parseBackgroundBashResultPayload,
  parseConclusionToolResultPayload,
  parseFileChangeResultPayload,
  parseMemoryInspectRebuildPayload,
  parseUnifiedDiffLines,
  parseUnifiedDiffSideBySideRows,
  createFocusedUnifiedDiffPreview,
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

  it("returns empty metadata for empty string", () => {
    const result = formatResultContent("");

    expect(result.isJson).toBe(false);
    expect(result.formattedText).toBe("");
  });

  it("treats plain text without JSON markers as text", () => {
    const text = "This is plain text";
    const result = formatResultContent(text);

    expect(result.isJson).toBe(false);
    expect(result.formattedText).toBe(text);
  });

  it("parses JSON arrays", () => {
    const payload = JSON.stringify([1, 2, 3]);
    const result = formatResultContent(payload);

    expect(result.isJson).toBe(true);
    expect(result.parsedJson).toEqual([1, 2, 3]);
  });

  it("extracts wrapped content from simple object with content field", () => {
    const payload = JSON.stringify({
      content: "Hello\\nWorld\\tTab",
    });
    const result = formatResultContent(payload);

    expect(result.isJson).toBe(false);
    expect(result.formattedText).toBe("Hello\nWorld\tTab");
    expect(result.parsedJson).toEqual({ content: "Hello\\nWorld\\tTab" });
  });

  it("extracts wrapped content from simple object with result field", () => {
    const payload = JSON.stringify({
      result: "Success\\nMessage",
    });
    const result = formatResultContent(payload);

    expect(result.isJson).toBe(false);
    expect(result.formattedText).toBe("Success\nMessage");
  });

  it("extracts wrapped content from simple object with output field", () => {
    const payload = JSON.stringify({
      output: "Task completed",
    });
    const result = formatResultContent(payload);

    expect(result.isJson).toBe(false);
    expect(result.formattedText).toBe("Task completed");
  });

  it("does not extract from objects with multiple fields", () => {
    const payload = JSON.stringify({
      content: "Hello",
      other: "field",
    });
    const result = formatResultContent(payload);

    expect(result.isJson).toBe(true);
    expect(result.formattedText).toContain('"content"');
    expect(result.formattedText).toContain('"other"');
  });

  it("does not extract when field value is not string", () => {
    const payload = JSON.stringify({
      content: { nested: "object" },
    });
    const result = formatResultContent(payload);

    expect(result.isJson).toBe(true);
  });

  it("does not extract from single-field object with wrong key", () => {
    const payload = JSON.stringify({
      data: "Some value",
    });
    const result = formatResultContent(payload);

    expect(result.isJson).toBe(true);
  });

  it("unescapes strings recursively in complex JSON", () => {
    const payload = JSON.stringify({
      message: "Line 1\\nLine 2",
      items: ["Item\\t1", "Item\\t2"],
    });
    const result = formatResultContent(payload);

    expect(result.isJson).toBe(true);
    expect(result.parsedJson).toEqual({
      message: "Line 1\nLine 2",
      items: ["Item\t1", "Item\t2"],
    });
  });

  it("handles non-Error objects thrown during parsing", () => {
    // Mock JSON.parse to throw a non-Error
    const originalParse = JSON.parse;
    JSON.parse = () => {
      throw "string error";
    };

    const result = formatResultContent('{"test": 1}');

    expect(result.isJson).toBe(false);
    expect(result.formattedText).toBe('{"test": 1}');

    JSON.parse = originalParse;
  });
});

describe("shouldCollapseContent", () => {
  it("collapses when content exceeds default limits", () => {
    const longContent = Array.from({ length: 30 }, (_, idx) => `line-${idx}`).join("\n");
    expect(shouldCollapseContent(longContent)).toBe(true);
  });

  it("honours custom collapse thresholds", () => {
    const content = "a".repeat(100);
    expect(shouldCollapseContent(content, { maxCharacters: 50 })).toBe(true);
    expect(shouldCollapseContent(content, { maxCharacters: 120 })).toBe(false);
  });

  it("returns false for empty content", () => {
    expect(shouldCollapseContent("")).toBe(false);
  });

  it("collapses based on line count threshold", () => {
    const shortContent = Array.from({ length: 5 }, (_, i) => `line${i}`).join("\n");
    expect(shouldCollapseContent(shortContent)).toBe(false);

    const longContent = Array.from({ length: 15 }, (_, i) => `line${i}`).join("\n");
    expect(shouldCollapseContent(longContent)).toBe(true);
  });

  it("collapses based on character count threshold", () => {
    const shortContent = "a".repeat(400);
    expect(shouldCollapseContent(shortContent)).toBe(false);

    const longContent = "a".repeat(600);
    expect(shouldCollapseContent(longContent)).toBe(true);
  });

  it("prioritizes line count over character count", () => {
    // Short in characters but many lines
    const manyLines = Array.from({ length: 10 }, () => "x").join("\n");
    expect(shouldCollapseContent(manyLines)).toBe(true);
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

  it("returns empty for empty content", () => {
    const preview = createContentPreview("");
    expect(preview.preview).toBe("");
    expect(preview.isTruncated).toBe(false);
  });

  it("uses default max length of 320", () => {
    const longContent = "a".repeat(400);
    const preview = createContentPreview(longContent);

    expect(preview.isTruncated).toBe(true);
    expect(preview.preview.length).toBe(321); // 320 + ellipsis
  });

  it("trims trailing whitespace before adding ellipsis", () => {
    const preview = createContentPreview("a b c d e   ", 5);
    expect(preview.preview).toBe("a b c…");
  });
});

describe("structured tool payload parsing", () => {
  it("parses conclusion payload", () => {
    const payload = JSON.stringify({
      type: "conclusion",
      title: "Conclusion",
      conclusion: "Ready to ship",
      key_points: ["Tests passed", "No blockers"],
      next_steps: ["Release"],
      confidence: "high",
    });

    expect(parseConclusionToolResultPayload(payload)).toEqual({
      type: "conclusion",
      title: "Conclusion",
      conclusion: "Ready to ship",
      key_points: ["Tests passed", "No blockers"],
      next_steps: ["Release"],
      confidence: "high",
    });
  });

  it("returns null for invalid conclusion payload", () => {
    const payload = JSON.stringify({ type: "conclusion", conclusion: "" });
    expect(parseConclusionToolResultPayload(payload)).toBeNull();
  });

  it("formats conclusion payload as markdown for normal assistant rendering", () => {
    const payload = JSON.stringify({
      type: "conclusion",
      title: "Conclusion",
      conclusion: "Ready to ship",
      key_points: ["Tests passed", "No blockers"],
      next_steps: ["Release"],
      confidence: "high",
    });

    expect(formatConclusionToolResultAsMarkdown(payload)).toBe(
      [
        "## Conclusion",
        "Ready to ship",
        "**Confidence:** high",
        "**Key points**\n- Tests passed\n- No blockers",
        "**Next steps**\n1. Release",
      ].join("\n\n"),
    );
  });

  it("parses interactive conclusion_with_options payload with conclusion", () => {
    const payload = JSON.stringify({
      status: "awaiting_user_input",
      question: "Any other requests before I finish?",
      options: ["OK", "Need changes"],
      allow_custom: true,
      conclusion: {
        title: "Conclusion",
        summary: "Core validation is complete and release is ready.",
        key_points: ["All targeted tests passed"],
        next_steps: ["Proceed with release train"],
        confidence: "high",
        mermaid: {
          graph: "graph TD\nA[Validated]-->B[Ready]",
        },
      },
    });

    expect(parseInteractiveQuestionToolResultPayload(payload)).toEqual({
      question: "Any other requests before I finish?",
      options: ["OK", "Need changes"],
      allow_custom: true,
      conclusion: {
        title: "Conclusion",
        summary: "Core validation is complete and release is ready.",
        key_points: ["All targeted tests passed"],
        next_steps: ["Proceed with release train"],
        confidence: "high",
        mermaid: {
          graph: "graph TD\nA[Validated]-->B[Ready]",
        },
      },
    });
  });

  it("formats conclusion_with_options conclusion payload as markdown with mermaid", () => {
    const markdown = formatConclusionWithOptionsConclusionAsMarkdown({
      title: "Conclusion",
      summary: "Ready to ship",
      key_points: ["Tests passed"],
      next_steps: ["Release"],
      confidence: "high",
      mermaid: {
        graph: "graph TD\nA-->B",
      },
    });

    expect(markdown).toContain("## Conclusion");
    expect(markdown).toContain("Ready to ship");
    expect(markdown).toContain("```mermaid");
    expect(markdown).toContain("graph TD");
  });

  it("parses request_permissions payload as interactive question", () => {
    const payload = JSON.stringify({
      status: "awaiting_permission_approval",
      question: "Approve filesystem write?",
      options: ["Approve", "Deny"],
      allow_custom: false,
    });

    expect(parseInteractiveQuestionToolResultPayload(payload)).toEqual({
      question: "Approve filesystem write?",
      options: ["Approve", "Deny"],
      allow_custom: false,
      conclusion: undefined,
    });
  });

  it("decodes unicode-escaped text in interactive question payload", () => {
    const payload = JSON.stringify({
      status: "awaiting_user_input",
      question: "\\u8bf7\\u786e\\u8ba4\\u662f\\u5426\\u7ee7\\u7eed\\u6267\\u884c\\uff1f",
      options: ["\\u7ee7\\u7eed", "\\u505c\\u6b62"],
      allow_custom: true,
      conclusion: {
        title: "Conclusion",
        summary: "\\u5df2\\u5b8c\\u6210\\u4e0a\\u4e0b\\u6587\\u538b\\u7f29\\u3002",
        key_points: ["\\u6458\\u8981\\u5df2\\u66f4\\u65b0"],
        next_steps: ["\\u7b49\\u5f85\\u4f60\\u7684\\u9009\\u62e9"],
      },
    });

    expect(parseInteractiveQuestionToolResultPayload(payload)).toEqual({
      question: "请确认是否继续执行？",
      options: ["继续", "停止"],
      allow_custom: true,
      conclusion: {
        title: "Conclusion",
        summary: "已完成上下文压缩。",
        key_points: ["摘要已更新"],
        next_steps: ["等待你的选择"],
        confidence: undefined,
        mermaid: undefined,
      },
    });
  });
});

describe("getStatusColor", () => {
  it("maps statuses to semantic colors", () => {
    expect(getStatusColor("success")).toBe("green");
    expect(getStatusColor("error")).toBe("red");
    expect(getStatusColor("warning")).toBe("orange");
    expect(getStatusColor("pending")).toBe("blue");
    expect(getStatusColor("running")).toBe("blue");
    expect(getStatusColor("unknown")).toBe("blue");
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
        unified:
          "--- a/demo.ts\n+++ b/demo.ts\n@@ -1,1 +1,1 @@\n-console.log('a')\n+console.log('b')",
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

  it("returns null for empty string", () => {
    expect(parseFileChangeResultPayload("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(parseFileChangeResultPayload("   ")).toBeNull();
  });

  it("returns null for non-JSON content", () => {
    expect(parseFileChangeResultPayload("not json")).toBeNull();
  });

  it("returns null for JSON without braces", () => {
    expect(parseFileChangeResultPayload('["array"]')).toBeNull();
  });

  it("returns null when file_path is missing", () => {
    const payload = JSON.stringify({
      operation: "Edit",
      diff: { unified: "--- a/file\n+++ b/file" },
    });
    expect(parseFileChangeResultPayload(payload)).toBeNull();
  });

  it("returns null when operation is missing", () => {
    const payload = JSON.stringify({
      file_path: "/tmp/file.ts",
      diff: { unified: "--- a/file\n+++ b/file" },
    });
    expect(parseFileChangeResultPayload(payload)).toBeNull();
  });

  it("returns null when diff is missing", () => {
    const payload = JSON.stringify({
      operation: "Edit",
      file_path: "/tmp/file.ts",
    });
    expect(parseFileChangeResultPayload(payload)).toBeNull();
  });

  it("returns null when diff.unified is missing", () => {
    const payload = JSON.stringify({
      operation: "Edit",
      file_path: "/tmp/file.ts",
      diff: {},
    });
    expect(parseFileChangeResultPayload(payload)).toBeNull();
  });

  it("returns null when file_path is not a string", () => {
    const payload = JSON.stringify({
      operation: "Edit",
      file_path: 123,
      diff: { unified: "--- a/file\n+++ b/file" },
    });
    expect(parseFileChangeResultPayload(payload)).toBeNull();
  });

  it("returns null when operation is not a string", () => {
    const payload = JSON.stringify({
      operation: { type: "Edit" },
      file_path: "/tmp/file.ts",
      diff: { unified: "--- a/file\n+++ b/file" },
    });
    expect(parseFileChangeResultPayload(payload)).toBeNull();
  });

  it("handles missing checkpoint gracefully", () => {
    const payload = JSON.stringify({
      operation: "Edit",
      file_path: "/tmp/file.ts",
      diff: { unified: "--- a/file\n+++ b/file" },
    });

    const parsed = parseFileChangeResultPayload(payload);
    expect(parsed).not.toBeNull();
    expect(parsed?.checkpoint).toBeUndefined();
  });

  it("handles invalid checkpoint gracefully", () => {
    const payload = JSON.stringify({
      operation: "Edit",
      file_path: "/tmp/file.ts",
      checkpoint: "invalid",
      diff: { unified: "--- a/file\n+++ b/file" },
    });

    const parsed = parseFileChangeResultPayload(payload);
    expect(parsed).not.toBeNull();
    expect(parsed?.checkpoint).toBeUndefined();
  });

  it("parses checkpoint with all fields", () => {
    const payload = JSON.stringify({
      operation: "Edit",
      file_path: "/tmp/file.ts",
      checkpoint: {
        created: true,
        id: "checkpoint-123",
        path: "/tmp/checkpoint",
        size_bytes: 1024,
        reason: "manual",
      },
      diff: { unified: "--- a/file\n+++ b/file" },
    });

    const parsed = parseFileChangeResultPayload(payload);
    expect(parsed?.checkpoint).toEqual({
      created: true,
      id: "checkpoint-123",
      path: "/tmp/checkpoint",
      size_bytes: 1024,
      reason: "manual",
    });
  });

  it("handles checkpoint with invalid field types", () => {
    const payload = JSON.stringify({
      operation: "Edit",
      file_path: "/tmp/file.ts",
      checkpoint: {
        created: "yes", // Invalid boolean
        id: 123, // Invalid string
        size_bytes: "large", // Invalid number
      },
      diff: { unified: "--- a/file\n+++ b/file" },
    });

    const parsed = parseFileChangeResultPayload(payload);
    expect(parsed?.checkpoint?.created).toBe(false); // Defaults to false
    expect(parsed?.checkpoint?.id).toBeUndefined();
    expect(parsed?.checkpoint?.size_bytes).toBeUndefined();
  });

  it("parses diff with all optional fields", () => {
    const payload = JSON.stringify({
      operation: "Edit",
      file_path: "/tmp/file.ts",
      diff: {
        unified: "--- a/file\n+++ b/file",
        old_line_count: 10,
        new_line_count: 15,
        added_lines: 8,
        removed_lines: 3,
        truncated: true,
      },
    });

    const parsed = parseFileChangeResultPayload(payload);
    expect(parsed?.diff.old_line_count).toBe(10);
    expect(parsed?.diff.new_line_count).toBe(15);
    expect(parsed?.diff.added_lines).toBe(8);
    expect(parsed?.diff.removed_lines).toBe(3);
    expect(parsed?.diff.truncated).toBe(true);
  });

  it("handles diff with invalid numeric fields", () => {
    const payload = JSON.stringify({
      operation: "Edit",
      file_path: "/tmp/file.ts",
      diff: {
        unified: "--- a/file\n+++ b/file",
        old_line_count: Infinity, // Invalid number
        added_lines: NaN, // Invalid number
      },
    });

    const parsed = parseFileChangeResultPayload(payload);
    expect(parsed?.diff.old_line_count).toBeUndefined();
    expect(parsed?.diff.added_lines).toBeUndefined();
  });

  it("parses payload with message and workspace", () => {
    const payload = JSON.stringify({
      operation: "Edit",
      message: "File edited successfully",
      file_path: "/tmp/file.ts",
      workspace: "/workspace",
      diff: { unified: "--- a/file\n+++ b/file" },
    });

    const parsed = parseFileChangeResultPayload(payload);
    expect(parsed?.message).toBe("File edited successfully");
    expect(parsed?.workspace).toBe("/workspace");
  });

  it("returns null for array at root level", () => {
    const payload = JSON.stringify([{ operation: "Edit", file_path: "/tmp/file.ts" }]);
    expect(parseFileChangeResultPayload(payload)).toBeNull();
  });
});

describe("parseMemoryInspectRebuildPayload", () => {
  it("parses inspect payloads with observability fields", () => {
    const payload = JSON.stringify({
      action: "inspect",
      data: {
        scope: "project",
        project_key: "zenith-123",
        total_memories: 4,
        by_type: { project: 2, reference: 2 },
        by_status: { active: 3, stale: 1 },
        recent_ids: ["mem_1", "mem_2"],
        view_files: ["dream.md"],
        index_files: ["lexical.json", "stale_candidates.json"],
        state_files: ["last_reindex.json"],
        stale_candidate_count: 1,
        last_reindex_at: "2026-04-03T13:00:00Z",
        last_dream_at: "2026-04-03T13:10:00Z",
        topic_paths: ["/tmp/memory/topic-a.md"],
      },
    });

    expect(parseMemoryInspectRebuildPayload(payload)).toEqual({
      action: "inspect",
      scope: undefined,
      project_key: undefined,
      data: {
        scope: "project",
        project_key: "zenith-123",
        total_memories: 4,
        by_type: { project: 2, reference: 2 },
        by_status: { active: 3, stale: 1 },
        recent_ids: ["mem_1", "mem_2"],
        view_files: ["dream.md"],
        index_files: ["lexical.json", "stale_candidates.json"],
        state_files: ["last_reindex.json"],
        stale_candidate_count: 1,
        last_reindex_at: "2026-04-03T13:00:00Z",
        last_dream_at: "2026-04-03T13:10:00Z",
        topic_paths: ["/tmp/memory/topic-a.md"],
      },
    });
  });

  it("creates compact previews for memory inspect or rebuild payloads", () => {
    const payload = JSON.stringify({
      action: "rebuild",
      data: {
        scope: "project",
        project_key: "zenith-123",
        total_memories: 7,
        by_type: {},
        by_status: {},
        recent_ids: [],
        view_files: [],
        index_files: [],
        state_files: [],
        stale_candidate_count: 0,
        topic_paths: [],
      },
    });

    expect(createCompactPreview(payload)).toBe("Memory rebuild: zenith-123 (7)");
  });

  it("returns null for non-memory structured payloads", () => {
    expect(
      parseMemoryInspectRebuildPayload(JSON.stringify({ action: "query", data: {} })),
    ).toBeNull();
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

  it("handles empty diff", () => {
    const lines = parseUnifiedDiffLines("");
    expect(lines).toEqual([{ kind: "context", text: "" }]);
  });

  it("handles diff with only context lines", () => {
    const diff = " context line 1\ncontext line 2";
    const lines = parseUnifiedDiffLines(diff);

    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.kind === "context")).toBe(true);
  });

  it("distinguishes --- file markers from removed lines", () => {
    const diff = "--- a/file.ts\n+++ b/file.ts\n-removed line";
    const lines = parseUnifiedDiffLines(diff);

    const metaLines = lines.filter((l) => l.kind === "meta");
    expect(metaLines).toHaveLength(2);
    expect(metaLines[0]?.text).toBe("--- a/file.ts");
    expect(metaLines[1]?.text).toBe("+++ b/file.ts");
  });

  it("distinguishes +++ file markers from added lines", () => {
    const diff = "--- a/file.ts\n+++ b/file.ts\n+added line";
    const lines = parseUnifiedDiffLines(diff);

    const metaLines = lines.filter((l) => l.kind === "meta");
    expect(metaLines).toHaveLength(2);
  });

  it("identifies standalone added lines", () => {
    const diff = "+added line 1\n+added line 2";
    const lines = parseUnifiedDiffLines(diff);

    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.kind === "add")).toBe(true);
  });

  it("identifies standalone removed lines", () => {
    const diff = "-removed line 1\n-removed line 2";
    const lines = parseUnifiedDiffLines(diff);

    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.kind === "remove")).toBe(true);
  });

  it("identifies modified lines (removed followed by added)", () => {
    const diff = "-old line\n+new line";
    const lines = parseUnifiedDiffLines(diff);

    expect(lines).toHaveLength(2);
    expect(lines[0]?.kind).toBe("modified_remove");
    expect(lines[1]?.kind).toBe("modified_add");
  });

  it("identifies modified blocks (multiple removed followed by multiple added)", () => {
    const diff = "-old line 1\n-old line 2\n+new line 1\n+new line 2";
    const lines = parseUnifiedDiffLines(diff);

    expect(lines).toHaveLength(4);
    expect(lines[0]?.kind).toBe("modified_remove");
    expect(lines[1]?.kind).toBe("modified_remove");
    expect(lines[2]?.kind).toBe("modified_add");
    expect(lines[3]?.kind).toBe("modified_add");
  });

  it("handles hunk headers", () => {
    const diff = "@@ -1,5 +1,6 @@\n context";
    const lines = parseUnifiedDiffLines(diff);

    expect(lines[0]?.kind).toBe("hunk");
    expect(lines[0]?.text).toBe("@@ -1,5 +1,6 @@");
  });

  it("does not treat lines starting with --- as meta if not followed by space", () => {
    const diff = "---not-meta";
    const lines = parseUnifiedDiffLines(diff);

    expect(lines[0]?.kind).toBe("context");
  });

  it("does not treat lines starting with +++ as meta if not followed by space", () => {
    const diff = "+++not-meta";
    const lines = parseUnifiedDiffLines(diff);

    // +++ without space is NOT considered a file marker, but it also doesn't start with +
    // so it's treated as context
    expect(lines[0]?.kind).toBe("context");
  });

  it("handles mixed diff content", () => {
    const diff = [
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -1,5 +1,6 @@",
      " context line",
      "-removed line 1",
      "-removed line 2",
      "+added line 1",
      "+added line 2",
      " context line 2",
      "+standalone add",
      "-standalone remove",
    ].join("\n");

    const lines = parseUnifiedDiffLines(diff);

    expect(lines.some((l) => l.kind === "meta")).toBe(true);
    expect(lines.some((l) => l.kind === "hunk")).toBe(true);
    expect(lines.some((l) => l.kind === "context")).toBe(true);
    expect(lines.some((l) => l.kind === "modified_remove")).toBe(true);
    expect(lines.some((l) => l.kind === "modified_add")).toBe(true);
    expect(lines.some((l) => l.kind === "add")).toBe(true);
    expect(lines.some((l) => l.kind === "remove")).toBe(true);
  });
});

describe("createFocusedUnifiedDiffPreview", () => {
  it("focuses preview around changed regions and inserts gap markers between distant hunks", () => {
    const preview = createFocusedUnifiedDiffPreview(
      [
        "--- a/demo.ts",
        "+++ b/demo.ts",
        "@@ -1,12 +1,12 @@",
        " context 1",
        " context 2",
        "-old 1",
        "+new 1",
        " context 3",
        " context 4",
        " context 5",
        " context 6",
        " context 7",
        " context 8",
        " context 9",
        " context 10",
        " context 11",
        "-old 2",
        "+new 2",
        " context 12",
      ].join("\n"),
      { contextLines: 1, maxLines: 10, preserveLeadingMeta: true },
    );

    expect(preview.some((line) => line.kind === "modified_remove" && line.text === "-old 1")).toBe(
      true,
    );
    expect(preview.some((line) => line.kind === "modified_add" && line.text === "+new 1")).toBe(
      true,
    );
    expect(preview.some((line) => line.kind === "modified_remove" && line.text === "-old 2")).toBe(
      true,
    );
    expect(preview.some((line) => line.kind === "modified_add" && line.text === "+new 2")).toBe(
      true,
    );
    expect(preview.some((line) => line.kind === "gap")).toBe(true);
    expect(preview.some((line) => line.text === " context 8")).toBe(false);
  });
});

describe("parseUnifiedDiffSideBySideRows", () => {
  it("builds side-by-side rows with line numbers for modified/add/remove blocks", () => {
    const rows = parseUnifiedDiffSideBySideRows(
      [
        "--- a/demo.ts",
        "+++ b/demo.ts",
        "@@ -2,2 +2,3 @@",
        " const keep = true;",
        "-const oldValue = 1;",
        "+const newValue = 1;",
        "+const added = true;",
        "-const removedOnly = false;",
      ].join("\n"),
    );

    expect(rows[0]).toMatchObject({ kind: "meta", text: "--- a/demo.ts" });
    expect(rows[1]).toMatchObject({ kind: "meta", text: "+++ b/demo.ts" });
    expect(rows[2]).toMatchObject({ kind: "hunk", text: "@@ -2,2 +2,3 @@" });
    expect(rows[3]).toMatchObject({
      kind: "context",
      oldLineNumber: 2,
      newLineNumber: 2,
      oldText: "const keep = true;",
      newText: "const keep = true;",
    });
    expect(rows[4]).toMatchObject({
      kind: "modified",
      oldLineNumber: 3,
      newLineNumber: 3,
      oldText: "const oldValue = 1;",
      newText: "const newValue = 1;",
    });
    expect(rows[5]).toMatchObject({
      kind: "add",
      newLineNumber: 4,
      newText: "const added = true;",
    });
    expect(rows[6]).toMatchObject({
      kind: "remove",
      oldLineNumber: 4,
      oldText: "const removedOnly = false;",
    });
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
        unified: "--- a/demo.ts\n+++ b/demo.ts\n@@ -1,1 +1,1 @@\n-const a = 1;\n+const a = 2;",
        added_lines: 8,
        removed_lines: 3,
      },
    });

    expect(getFileChangeDiffStats(payload)).toEqual({
      added: 8,
      removed: 3,
    });
  });

  it("returns null for non-file-change payload", () => {
    const payload = JSON.stringify({ hello: "world" });
    expect(getFileChangeDiffStats(payload)).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(getFileChangeDiffStats("{not: json}")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(getFileChangeDiffStats("")).toBeNull();
  });

  it("counts added and removed lines correctly from unified diff", () => {
    const payload = JSON.stringify({
      operation: "Edit",
      file_path: "/tmp/file.ts",
      diff: {
        unified:
          "--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,5 @@\n context\n-removed\n+added 1\n+added 2",
      },
    });

    const stats = getFileChangeDiffStats(payload);
    expect(stats).toEqual({ added: 2, removed: 1 });
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

  it("returns 'No content' for empty string", () => {
    expect(createCompactPreview("")).toBe("No content");
  });

  it("returns short content unchanged", () => {
    const shortText = "Short text";
    expect(createCompactPreview(shortText)).toBe(shortText);
  });

  it("truncates long plain text", () => {
    const longText = "a".repeat(100);
    const preview = createCompactPreview(longText);

    expect(preview.length).toBe(61); // 60 chars + ellipsis
    expect(preview.endsWith("…")).toBe(true);
  });

  it("extracts content field from JSON", () => {
    const payload = JSON.stringify({
      content: "Test message that is long enough to trigger JSON parsing",
    });
    expect(createCompactPreview(payload)).toBe(
      "Test message that is long enough to trigger JSON parsing",
    );
  });

  it("extracts result field from JSON", () => {
    const payload = JSON.stringify({
      result: "Success result message that exceeds 60 characters limit",
    });
    expect(createCompactPreview(payload)).toBe(
      "Success result message that exceeds 60 characters limit",
    );
  });

  it("extracts output field from JSON", () => {
    const payload = JSON.stringify({
      output: "Command output that is longer than the 60 character limit",
    });
    expect(createCompactPreview(payload)).toBe(
      "Command output that is longer than the 60 character limit",
    );
  });

  it("extracts message field from JSON", () => {
    const payload = JSON.stringify({
      message: "Info message that exceeds the 60 character limit for preview",
    });
    expect(createCompactPreview(payload)).toBe(
      "Info message that exceeds the 60 character limit for preview",
    );
  });

  it("extracts data field from JSON", () => {
    const payload = JSON.stringify({
      data: "Data value exactly 60 chars to avoid truncation here now",
      extra: "padding to exceed 60 total chars for json parsing",
    });
    expect(createCompactPreview(payload)).toBe(
      "Data value exactly 60 chars to avoid truncation here now",
    );
  });

  it("truncates long extracted field", () => {
    const longContent = "a".repeat(100);
    const payload = JSON.stringify({
      content: longContent,
      padding: "to make it longer than 60 chars total",
    });
    const preview = createCompactPreview(payload);

    expect(preview.length).toBe(61); // 60 + ellipsis
    expect(preview.endsWith("…")).toBe(true);
  });

  it("shows array count for JSON arrays", () => {
    // Make array string representation longer than 60 chars using strings
    const payload = JSON.stringify([
      "item1",
      "item2",
      "item3",
      "item4",
      "item5",
      "item6",
      "item7",
      "item8",
    ]);
    expect(createCompactPreview(payload)).toBe("Array with 8 items");
  });

  it("shows property count for JSON objects", () => {
    // Make object string representation longer than 60 chars
    const payload = JSON.stringify({
      first_key: 1,
      second_key: 2,
      third_key: 3,
      fourth_key: 4,
      fifth_key: 5,
      sixth_key: 6,
    });
    expect(createCompactPreview(payload)).toBe("Object with 6 properties");
  });

  it("shows singular property for single-key object", () => {
    const payload = JSON.stringify({
      only: "a very long field value that exceeds 60 characters",
    }); // Longer than 60 chars
    expect(createCompactPreview(payload)).toBe("Object with 1 property");
  });

  it("ignores non-string fields in result extraction", () => {
    const payload = JSON.stringify({
      content: { nested: "a very long object value that exceeds 60 characters" },
    }); // Longer than 60 chars, nested object not extracted
    // Should fall through to object count
    expect(createCompactPreview(payload)).toBe("Object with 1 property");
  });

  it("handles JSON parse errors gracefully", () => {
    const invalidJson = '{"broken": json}';
    const preview = createCompactPreview(invalidJson);

    // Should truncate the raw text
    expect(preview.length).toBeLessThanOrEqual(61);
  });

  it("truncates long file path in file change payload", () => {
    // Use a very long filename (not just path) to test truncation
    const longFilename = "a".repeat(70) + ".txt";
    const payload = JSON.stringify({
      operation: "Edit",
      file_path: `/tmp/${longFilename}`,
      diff: { unified: "--- a/file\n+++ b/file" },
    });

    const preview = createCompactPreview(payload);
    expect(preview.length).toBeLessThanOrEqual(61);
    expect(preview.endsWith("…")).toBe(true);
    expect(preview).toContain("Edit:");
  });
});

describe("isPermissionApprovalResult", () => {
  it("detects a permission-approval payload from any gated tool", () => {
    const payload = JSON.stringify({
      status: "awaiting_permission_approval",
      question: "**Permission required**\n\nThe `Bash` tool needs approval…",
      options: ["Approve", "Deny"],
      allow_custom: false,
    });
    expect(isPermissionApprovalResult(payload)).toBe(true);
  });

  it("returns false for non-permission results", () => {
    expect(isPermissionApprovalResult(JSON.stringify({ result: "ok" }))).toBe(false);
    expect(isPermissionApprovalResult("plain text output")).toBe(false);
    expect(isPermissionApprovalResult(JSON.stringify({ status: "awaiting_user_input" }))).toBe(
      false,
    );
  });

  it("turns a legacy permission status without a question into a safe card payload", () => {
    const payload = parseInteractiveQuestionToolResultPayload(
      JSON.stringify({
        status: "awaiting_permission_approval",
        type: "execute",
        resource: { command: "rm -rf /tmp/example" },
      }),
    );

    expect(payload).toEqual(
      expect.objectContaining({
        question: "Permission approval required",
        options: ["Approve", "Deny"],
        allow_custom: false,
      }),
    );
    expect(JSON.stringify(payload)).not.toContain("rm -rf");
  });
});

describe("parseBackgroundBashResultPayload", () => {
  it("detects a background shell result (bash_id + status running)", () => {
    const payload = JSON.stringify({
      bash_id: "bash-123",
      command: "npm run build",
      status: "running",
      cwd: "/repo",
      environment: {},
    });
    expect(parseBackgroundBashResultPayload(payload)).toEqual({
      bashId: "bash-123",
      command: "npm run build",
    });
  });

  it("rejects a command-less running result — a BashOutput/BashInput read, not a launch", () => {
    // BashOutput of a still-running shell: {bash_id, status:"running", exit_code, output, ...} — no command.
    expect(
      parseBackgroundBashResultPayload(
        JSON.stringify({ bash_id: "b1", status: "running", output: "…", next_cursor: 5 }),
      ),
    ).toBeNull();
    // BashInput write to a running interactive shell: {bash_id, status:"running", bytes_written, ...} — no command.
    expect(
      parseBackgroundBashResultPayload(
        JSON.stringify({ bash_id: "b1", status: "running", bytes_written: 3, stdin_closed: false }),
      ),
    ).toBeNull();
    // Non-string command is treated as absent.
    expect(
      parseBackgroundBashResultPayload(
        JSON.stringify({ bash_id: "b1", command: 42, status: "running" }),
      ),
    ).toBeNull();
  });

  it("returns null when it is not a running background shell", () => {
    // Missing bash_id.
    expect(
      parseBackgroundBashResultPayload(JSON.stringify({ command: "x", status: "running" })),
    ).toBeNull();
    // Non-string bash_id.
    expect(
      parseBackgroundBashResultPayload(
        JSON.stringify({ bash_id: 7, command: "x", status: "running" }),
      ),
    ).toBeNull();
    // A completed/other status is not the initial "running" marker.
    expect(
      parseBackgroundBashResultPayload(
        JSON.stringify({ bash_id: "b1", command: "x", status: "completed" }),
      ),
    ).toBeNull();
    // Plain text and non-JSON.
    expect(parseBackgroundBashResultPayload("done")).toBeNull();
    expect(parseBackgroundBashResultPayload("")).toBeNull();
  });
});
