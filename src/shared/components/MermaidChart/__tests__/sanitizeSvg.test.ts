import { describe, it, expect } from "vitest";
import { sanitizeSvgMarkup } from "../sanitizeSvg";

// Representative slice of Mermaid's strict/htmlLabels:false output: an inline
// <style> block that colors the diagram, native <text> labels (no
// <foreignObject>), shapes, and an arrowhead <marker>.
const MERMAID_SVG = `
<svg id="mermaid-1" viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg" role="graphics-document document" aria-roledescription="flowchart-v2">
  <style>#mermaid-1 .node rect{fill:#eee;stroke:#333}#mermaid-1 .edgeLabel{color:#111}</style>
  <defs><marker id="arrow" markerWidth="10" markerHeight="10"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>
  <g class="node"><rect x="0" y="0" width="80" height="40" rx="4"/><text x="40" y="20" text-anchor="middle" dominant-baseline="middle">开始 Start</text></g>
  <path class="edge" d="M80,20 L160,20" marker-end="url(#arrow)"/>
</svg>`;

describe("sanitizeSvgMarkup", () => {
  const clean = sanitizeSvgMarkup(MERMAID_SVG);

  it("preserves the inline <style> block that colors the diagram", () => {
    expect(clean).toContain("<style");
    expect(clean).toContain(".node rect");
    expect(clean).toContain("fill:#eee");
  });

  it("preserves native SVG <text> labels including non-ASCII content", () => {
    expect(clean).toContain("开始 Start");
    expect(clean).toContain("dominant-baseline");
  });

  it("preserves shapes, markers and edges", () => {
    expect(clean).toContain("<rect");
    expect(clean).toContain("<marker");
    expect(clean).toContain("marker-end");
    expect(clean).toContain("<path");
  });

  it("strips scriptable content", () => {
    const malicious = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect/></svg>`;
    const sanitized = sanitizeSvgMarkup(malicious);
    expect(sanitized).not.toContain("<script");
    expect(sanitized).toContain("<rect");
  });
});
