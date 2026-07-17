import mermaid from "mermaid";

// Initialize with minimal config - theme will be set dynamically by useMermaidTheme hook
mermaid.initialize({
  startOnLoad: false,
  theme: "dark", // Default, will be overridden by useMermaidTheme
  // strict: encode tags in diagram text + disable click handlers. Paired with
  // DOMPurify sanitization at injection time (MermaidChartViewer).
  securityLevel: "strict",
  // TOP-LEVEL htmlLabels:false is the switch that forces native SVG <text>
  // node labels. In mermaid 11.15 the per-diagram flowchart.htmlLabels:false is
  // NOT enough — flowchart-v2 still emits <foreignObject> unless this is set.
  // Native <text> is required so labels survive DOMPurify and render when the
  // SVG is rasterized via <img> for PDF export (img-loaded SVGs never paint
  // foreignObject HTML).
  htmlLabels: false,
  suppressErrorRendering: true,
  // SECURITY (issue #38): lock CSS-bearing config keys so a per-diagram
  // `%%{init:{"themeCSS":"..."}}%%` directive (or YAML frontmatter `config:`
  // block) — both fully attacker-controlled when chart text comes from an
  // LLM/tool under prompt injection — cannot set them. `securityLevel:'strict'`
  // does NOT cover this: mermaid's default `secure` list doesn't include
  // `themeCSS`, and unlike every other diagram-generated style rule (which
  // goes through mermaid's own stylis-based `#<svgId>`-namespacing compiler),
  // `themeCSS` is spliced into the <style> block as raw, unscoped text
  // (mermaidAPI.ts `createCssStyles`) — only checked for balanced braces, not
  // selector scope or embedded `url()`. An unscoped selector in inline SVG
  // <style> is NOT scoped by the browser to the SVG subtree; it reaches the
  // whole host document, including chrome like the in-chat permission
  // Approve/Deny UI. `mermaid.initialize`'s `secure` array is additive (see
  // src/config.ts assignWithDepth array-merge), so this appends to mermaid's
  // own defaults rather than replacing them. Kept in sync with the `secure`
  // list in useMermaidTheme.ts (every `initialize()` call resets `secure` to
  // defaults + its own overrides, so both call sites must set it).
  secure: ["themeCSS", "themeVariables", "fontFamily"],
});

mermaid.parseError = function (err) {
  console.warn("Mermaid parse error (handled gracefully):", err);
};

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

export default mermaid;
