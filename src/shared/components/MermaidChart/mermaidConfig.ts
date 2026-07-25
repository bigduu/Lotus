// Mermaid is intentionally NOT statically imported here. A top-level
// `import mermaid from "mermaid"` would pull the entire ~667 KB mermaid bundle
// (plus wardley/katex grammars) into the critical first-paint path, even though
// most sessions never render a diagram. Initialization is deferred to the
// async `getMermaid()` lazy loader in `mermaidRenderManager.ts`, which is the
// single import boundary for the mermaid package.

export const mermaidCache = new Map<
  string,
  { svg: string; height: number; svgWidth: number; svgHeight: number }
>();

export const errorCache = new Map<string, { count: number; lastSeen: number }>();

const GANTT_HEADER_RE = /^(\s*%%\{[\s\S]*?\}%%\s*)*\s*gantt\b/i;

const normalizeGanttPunctuation = (chart: string): string => {
  return chart
    .replace(/：/g, ":")
    .replace(/，/g, ",")
    .replace(/；/g, ";")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/－/g, "-");
};

export const normalizeMermaidChart = (chart: string): string => {
  const input = GANTT_HEADER_RE.test(chart) ? normalizeGanttPunctuation(chart) : chart;

  return input.replace(/\[([\s\S]*?)\]/g, (match, rawLabel) => {
    const label = String(rawLabel);
    const hasNewline = /\r?\n/.test(label);
    const hasParen = /[()]/.test(label);
    const hasAtSign = /@/.test(label);
    if (!hasNewline && !hasParen && !hasAtSign) {
      return match;
    }

    const trimmed = label.trim();
    const parensAreShape = trimmed.startsWith("(") && trimmed.endsWith(")") && trimmed.length >= 2;

    let nextLabel = label;
    if (hasNewline) {
      nextLabel = nextLabel.replace(/\r?\n/g, "<br/>");
    }
    if (hasParen && !parensAreShape) {
      nextLabel = nextLabel.replace(/\(/g, "&#40;").replace(/\)/g, "&#41;");
    }
    if (hasAtSign) {
      nextLabel = nextLabel.replace(/@/g, "&#64;");
    }

    return nextLabel === label ? match : `[${nextLabel}]`;
  });
};

export const cleanupErrorCache = () => {
  const now = Date.now();
  const fiveMinutes = 5 * 60 * 1000;

  for (const [key, value] of errorCache.entries()) {
    if (now - value.lastSeen > fiveMinutes) {
      errorCache.delete(key);
    }
  }
};
