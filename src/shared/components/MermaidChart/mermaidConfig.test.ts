import { describe, expect, it } from "vitest";
import { normalizeMermaidChart } from "./mermaidConfig";

describe("normalizeMermaidChart", () => {
  it("normalizes full-width punctuation for gantt charts", () => {
    const input = [
      "gantt",
      "  title 项目计划",
      "  dateFormat YYYY-MM-DD",
      "  section 需求阶段",
      "  需求收集 ：done， d1， 2025－01－01， 3d",
    ].join("\n");

    const normalized = normalizeMermaidChart(input);

    expect(normalized).toContain("需求收集 :done, d1, 2025-01-01, 3d");
    expect(normalized).not.toContain("：");
    expect(normalized).not.toContain("，");
    expect(normalized).not.toContain("－");
  });

  it("does not apply gantt punctuation normalization to non-gantt charts", () => {
    const input = "graph TD\nA[任务：进行中] --> B[完成]";
    const normalized = normalizeMermaidChart(input);

    expect(normalized).toBe(input);
  });
});
