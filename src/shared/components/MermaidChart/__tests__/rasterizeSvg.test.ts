import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rasterizeSvgToPng } from "../rasterizeSvg";

// Mock Image constructor — mirrors the pattern used by imageUtils.test.ts.
class MockImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src = "";

  set src(value: string) {
    this._src = value;
    MockImage.lastSrc = value;
    // Synchronous "load" so tests don't need to await a tick.
    this.onload?.();
  }

  get src(): string {
    return this._src;
  }

  static lastSrc = "";
}

describe("rasterizeSvgToPng", () => {
  let originalImage: typeof Image;

  beforeEach(() => {
    originalImage = global.Image;
    global.Image = MockImage as unknown as typeof Image;
    MockImage.lastSrc = "";

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillStyle: "",
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,mock",
    );
  });

  afterEach(() => {
    global.Image = originalImage;
    vi.restoreAllMocks();
  });

  const svgWithSize = (styleContent: string) =>
    `<svg id="mermaid-1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><style>${styleContent}</style><rect class="node" width="10" height="10"/></svg>`;

  it("returns a rasterized PNG result for a normal diagram", async () => {
    const result = await rasterizeSvgToPng(svgWithSize("#mermaid-1 .node{fill:#eee}"), 2);

    expect(result).not.toBeNull();
    expect(result?.width).toBe(100);
    expect(result?.height).toBe(50);
    expect(result?.url).toBe("data:image/png;base64,mock");
  });

  it("sanitizes the svg before building the <img> data URL (issue #38)", async () => {
    // Even though loading via <img src="data:..."> already isolates any
    // inline <style> from the host document's CSSOM, a `url()` beacon inside
    // an unscoped rule would still fire as a tracking request on every
    // render. rasterizeSvgToPng must sanitize before this point.
    const malicious = svgWithSize(
      `body{display:none} #mermaid-1 .node{background:url(https://evil.example/beacon)}`,
    );

    await rasterizeSvgToPng(malicious, 2);

    expect(MockImage.lastSrc).not.toContain("evil.example");
    // decodeURIComponent to check for the raw selector text, since the data
    // URL is percent-encoded.
    expect(decodeURIComponent(MockImage.lastSrc)).not.toMatch(/\bbody\s*\{/);
  });

  it("returns null when the svg has no measurable width/height", async () => {
    const result = await rasterizeSvgToPng(
      `<svg xmlns="http://www.w3.org/2000/svg"></svg>`,
      2,
    );

    expect(result).toBeNull();
  });

  it("returns null for empty input", async () => {
    const result = await rasterizeSvgToPng("", 2);
    expect(result).toBeNull();
  });
});
