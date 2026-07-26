import { beforeEach, describe, expect, it, vi } from "vitest";

const mockParse = vi.fn();
const mockRender = vi.fn();

vi.mock("mermaid", () => ({
  default: {
    // The lazy `getMermaid()` loader calls `initialize()` on first use —
    // the mock must provide it (#145 turned the import lazy).
    initialize: vi.fn(),
    parse: mockParse,
    render: mockRender,
  },
}));

const sanitizeSvgMarkupSpy = vi.fn((svg: string) => svg);
vi.mock("./sanitizeSvg", () => ({
  sanitizeSvgMarkup: (svg: string) => sanitizeSvgMarkupSpy(svg),
}));

const loadRenderManager = async () => {
  vi.resetModules();
  return import("./mermaidRenderManager");
};

const svgWithViewBox = (width: number, height: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="10" height="10" /></svg>`;

describe("mermaidRenderManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sanitizeSvgMarkupSpy.mockClear();
    sanitizeSvgMarkupSpy.mockImplementation((svg: string) => svg);
  });

  it("reuses cached result on repeated render calls", async () => {
    mockParse.mockResolvedValue(undefined);
    mockRender.mockResolvedValue({ svg: svgWithViewBox(320, 180) });

    const manager = await loadRenderManager();
    const first = await manager.renderMermaidCached("chart-key", "graph TD\nA-->B");
    const second = await manager.renderMermaidCached("chart-key", "graph TD\nA-->B");

    expect(first).toBe(second);
    expect(first.width).toBe(320);
    expect(first.height).toBe(180);
    expect(mockParse).toHaveBeenCalledTimes(1);
    expect(mockRender).toHaveBeenCalledTimes(1);
    expect(manager.getCacheStats()).toEqual({ cacheSize: 1, inFlightSize: 0 });
  });

  it("deduplicates in-flight requests for the same chart key", async () => {
    mockParse.mockResolvedValue(undefined);
    let resolveRender: ((value: { svg: string }) => void) | undefined;
    mockRender.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRender = resolve;
        }),
    );

    const manager = await loadRenderManager();
    const p1 = manager.renderMermaidCached("same-key", "graph TD\nA-->B");
    const p2 = manager.renderMermaidCached("same-key", "graph TD\nA-->B");

    expect(p1).toBe(p2);
    expect(manager.getCacheStats().inFlightSize).toBe(1);

    await vi.waitFor(() => {
      expect(mockRender).toHaveBeenCalledTimes(1);
      expect(resolveRender).toBeTypeOf("function");
    });
    resolveRender?.({ svg: svgWithViewBox(120, 60) });
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toEqual(r2);
    expect(mockParse).toHaveBeenCalledTimes(1);
    expect(mockRender).toHaveBeenCalledTimes(1);
    expect(manager.getCacheStats().inFlightSize).toBe(0);
  });

  it("throws when rendered svg contains negative rect widths", async () => {
    mockParse.mockResolvedValue(undefined);
    mockRender.mockResolvedValue({
      svg: `<svg xmlns="http://www.w3.org/2000/svg"><rect width="-1" /></svg>`,
    });

    const manager = await loadRenderManager();

    await expect(manager.renderMermaidCached("invalid-key", "graph TD\nA-->B")).rejects.toThrow(
      "rect widths < 0",
    );

    expect(manager.getCacheStats()).toEqual({ cacheSize: 0, inFlightSize: 0 });
  });

  it("falls back to getBoundingClientRect when viewBox is missing", async () => {
    mockParse.mockResolvedValue(undefined);
    mockRender.mockResolvedValue({
      svg: `<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" /></svg>`,
    });

    const rect = {
      x: 0,
      y: 0,
      width: 432,
      height: 210,
      top: 0,
      left: 0,
      right: 432,
      bottom: 210,
      toJSON: () => ({}),
    } as DOMRect;
    const getBoundingClientRectSpy = vi
      .spyOn(SVGElement.prototype, "getBoundingClientRect")
      .mockReturnValue(rect);

    const manager = await loadRenderManager();
    const result = await manager.renderMermaidCached("fallback-key", "graph TD\nA-->B");

    expect(result.width).toBe(432);
    expect(result.height).toBe(210);
    getBoundingClientRectSpy.mockRestore();
  });

  it("sanitizes the raw svg before it is attached to document.body for measurement (issue #38)", async () => {
    // When viewBox is missing, the manager falls back to attaching a
    // measurement <div> straight to document.body and reading its
    // getBoundingClientRect(). Mermaid's raw render output is
    // pre-sanitization, so an inline <style> with an unscoped selector would
    // apply to the live document for as long as that div is attached unless
    // it's sanitized first.
    const maliciousSvg = `<svg xmlns="http://www.w3.org/2000/svg"><style>body{display:none}</style><rect width="10" height="10" /></svg>`;
    mockParse.mockResolvedValue(undefined);
    mockRender.mockResolvedValue({ svg: maliciousSvg });

    const getBoundingClientRectSpy = vi
      .spyOn(SVGElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        top: 0,
        left: 0,
        right: 100,
        bottom: 50,
        toJSON: () => ({}),
      } as DOMRect);

    const manager = await loadRenderManager();
    await manager.renderMermaidCached("unsanitized-fallback-key", "graph TD\nA-->B");

    expect(sanitizeSvgMarkupSpy).toHaveBeenCalledWith(maliciousSvg);
    getBoundingClientRectSpy.mockRestore();
  });

  it("accepts raw string render results", async () => {
    mockParse.mockResolvedValue(undefined);
    mockRender.mockResolvedValue(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 77 33"></svg>`,
    );

    const manager = await loadRenderManager();
    const result = await manager.renderMermaidCached("raw-string", "graph TD\nA-->B");

    expect(result.svg).toContain("<svg");
    expect(result.width).toBe(77);
    expect(result.height).toBe(33);
  });

  it("evicts least-recently-used entries when cache exceeds max size", async () => {
    mockParse.mockResolvedValue(undefined);
    mockRender.mockResolvedValue({ svg: svgWithViewBox(200, 100) });

    const manager = await loadRenderManager();

    for (let i = 0; i < 201; i += 1) {
      await manager.renderMermaidCached(`chart-${i}`, `graph TD\nA-->B${i}`);
    }

    expect(manager.getCacheStats().cacheSize).toBe(200);
    expect(manager.getCachedMermaid("chart-0")).toBeNull();
    expect(manager.getCachedMermaid("chart-1")).not.toBeNull();

    // Refresh chart-1 then force one more eviction. chart-2 should drop first.
    expect(manager.getCachedMermaid("chart-1")).not.toBeNull();
    await manager.renderMermaidCached("chart-201", "graph TD\nA-->B");
    expect(manager.getCachedMermaid("chart-1")).not.toBeNull();
    expect(manager.getCachedMermaid("chart-2")).toBeNull();
  });

  it("clears cache and in-flight maps", async () => {
    mockParse.mockResolvedValue(undefined);
    mockRender.mockResolvedValue({ svg: svgWithViewBox(100, 80) });

    const manager = await loadRenderManager();
    await manager.renderMermaidCached("cache-key", "graph TD\nA-->B");
    expect(manager.getCacheStats()).toEqual({ cacheSize: 1, inFlightSize: 0 });

    manager.clearMermaidRenderCache();
    expect(manager.getCacheStats()).toEqual({ cacheSize: 0, inFlightSize: 0 });
    expect(manager.getCachedMermaid("cache-key")).toBeNull();
  });

  it("removes temporary render host even when mermaid.render throws", async () => {
    mockParse.mockResolvedValue(undefined);
    mockRender.mockRejectedValue(new Error("render failed"));

    const manager = await loadRenderManager();
    const beforeCount = document.body.childElementCount;

    await expect(manager.renderMermaidCached("render-error", "graph TD\nA-->B")).rejects.toThrow(
      "render failed",
    );

    expect(document.body.childElementCount).toBe(beforeCount);
    expect(manager.getCacheStats()).toEqual({ cacheSize: 0, inFlightSize: 0 });
  });
});
