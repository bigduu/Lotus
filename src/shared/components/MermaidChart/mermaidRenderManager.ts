import { sanitizeSvgMarkup } from "./sanitizeSvg";

export type MermaidRenderResult = {
  svg: string;
  width: number;
  height: number;
};

const MAX_CACHE = 200;

// LRU: Map 的迭代顺序就是插入顺序，get 时 refresh
const resultCache = new Map<string, MermaidRenderResult>();
const inFlight = new Map<string, Promise<MermaidRenderResult>>();

let mermaidPromise: Promise<typeof import("mermaid")> | null = null;

const countInvalidNegativeRectWidths = (svgMarkup: string): number => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgMarkup, "image/svg+xml");
  const rects = Array.from(doc.querySelectorAll("rect"));
  return rects.reduce((count, rect) => {
    const width = Number(rect.getAttribute("width"));
    return Number.isFinite(width) && width < 0 ? count + 1 : count;
  }, 0);
};

async function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid");
  }
  const mod = await mermaidPromise;
  return mod.default ?? mod;
}

function lruSet(key: string, val: MermaidRenderResult) {
  if (resultCache.has(key)) resultCache.delete(key);
  resultCache.set(key, val);
  if (resultCache.size > MAX_CACHE) {
    const firstKey = resultCache.keys().next().value as string | undefined;
    if (firstKey) resultCache.delete(firstKey);
  }
}

export function getCachedMermaid(chartKey: string) {
  const v = resultCache.get(chartKey);
  if (!v) return null;
  // refresh LRU
  resultCache.delete(chartKey);
  resultCache.set(chartKey, v);
  return v;
}

export function clearMermaidRenderCache() {
  resultCache.clear();
  inFlight.clear();
}

export function renderMermaidCached(chartKey: string, normalizedChart: string) {
  const cached = getCachedMermaid(chartKey);
  if (cached) return Promise.resolve(cached);

  const existing = inFlight.get(chartKey);
  if (existing) return existing;

  const p = (async () => {
    const mermaid = await getMermaid();

    await mermaid.parse(normalizedChart);

    // 用 chartKey 派生一个确定性的 id，避免每次 render 生成不同 id 导致缓存难复用
    const id = `mermaid-${chartKey}`;
    // Mermaid v11 expects a real DOM container in some environments.
    // NOTE: Do NOT use width:0 here. Some diagrams (notably gantt) derive layout
    // from the host width and can emit negative SVG rect widths when container
    // width is zero, which results in blank charts without parser errors.
    const renderHost = document.createElement("div");
    const viewportWidth = Math.max(
      1600,
      window.innerWidth || 0,
      document.documentElement?.clientWidth || 0,
    );
    renderHost.style.cssText = [
      "position:absolute",
      "left:-9999px",
      "top:-9999px",
      `width:${viewportWidth}px`,
      `min-width:${viewportWidth}px`,
      "visibility:hidden",
      "pointer-events:none",
      "overflow:visible",
    ].join(";");
    document.body.appendChild(renderHost);
    let renderResult: { svg: string } | string;
    try {
      renderResult = await mermaid.render(id, normalizedChart, renderHost);
    } finally {
      document.body.removeChild(renderHost);
    }
    const svg =
      typeof renderResult === "object" && "svg" in renderResult
        ? renderResult.svg
        : String(renderResult);

    const invalidNegativeRectCount = countInvalidNegativeRectWidths(svg);
    if (invalidNegativeRectCount > 0) {
      throw new Error(`Mermaid rendered invalid SVG (${invalidNegativeRectCount} rect widths < 0)`);
    }

    // 使用 DOMParser 测量 SVG 尺寸
    const parser = new DOMParser();
    const doc = parser.parseFromString(svg, "image/svg+xml");
    const svgElement = doc.querySelector("svg");

    let width = 800;
    let height = 300;

    if (svgElement) {
      const viewBox = svgElement.getAttribute("viewBox");
      if (viewBox) {
        const parts = viewBox.split(/\s+/).map(Number);
        if (parts.length === 4) {
          width = parts[2] || 800;
          height = parts[3] || 300;
        }
      }

      // 备用方案：使用 getBoundingClientRect
      if (width === 800 && height === 300) {
        const tempDiv = document.createElement("div");
        tempDiv.style.cssText = "position:absolute;visibility:hidden;width:800px;";
        // `svg` here is mermaid's raw, pre-sanitization output — sanitize
        // before it's attached to document.body, otherwise an inline <style>
        // with an unscoped selector (e.g. via a malicious themeCSS directive
        // in attacker-influenced chart text) applies to the live document for
        // as long as this element is attached. See issue #38.
        tempDiv.innerHTML = sanitizeSvgMarkup(svg);
        document.body.appendChild(tempDiv);

        const rect = tempDiv.querySelector("svg")?.getBoundingClientRect();
        if (rect) {
          width = rect.width;
          height = rect.height;
        }

        document.body.removeChild(tempDiv);
      }
    }

    const out = { svg, width, height };

    // 关键：cache 不依赖组件 mounted
    lruSet(chartKey, out);

    return out;
  })().finally(() => {
    inFlight.delete(chartKey);
  });

  inFlight.set(chartKey, p);
  return p;
}

// For debugging
export function getCacheStats() {
  return {
    cacheSize: resultCache.size,
    inFlightSize: inFlight.size,
  };
}
