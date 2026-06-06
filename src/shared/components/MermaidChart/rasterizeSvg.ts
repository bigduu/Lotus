export interface RasterResult {
  /** PNG data URL, rendered at `scale`x the diagram's intrinsic size. */
  url: string;
  /** Intrinsic (CSS px) width — use this for layout, the PNG itself is higher-res. */
  width: number;
  /** Intrinsic (CSS px) height. */
  height: number;
}

interface PreparedSvg {
  width: number;
  height: number;
  markup: string;
}

/**
 * Read a Mermaid SVG's intrinsic size from its viewBox (falling back to
 * width/height attributes) and return a self-contained, explicitly-sized markup
 * string suitable for loading into an <img>.
 */
const prepareSvg = (svgMarkup: string): PreparedSvg => {
  const doc = new DOMParser().parseFromString(svgMarkup, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg) {
    return { width: 0, height: 0, markup: svgMarkup };
  }

  let width = 0;
  let height = 0;

  const viewBox = svg.getAttribute("viewBox");
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      width = parts[2];
      height = parts[3];
    }
  }

  if (!width) width = parseFloat(svg.getAttribute("width") || "") || 0;
  if (!height) height = parseFloat(svg.getAttribute("height") || "") || 0;

  if (width && height) {
    // Mermaid sets style="max-width:Npx" + width="100%"; force the intrinsic
    // pixel size so the rasterized image is at full resolution, not clamped.
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.style.maxWidth = "none";
  }
  if (!svg.getAttribute("xmlns")) {
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }

  return { width, height, markup: new XMLSerializer().serializeToString(svg) };
};

const loadImage = (src: string): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });

/**
 * Rasterize a Mermaid SVG to a high-DPI PNG data URL.
 *
 * Used by the PDF export path: html2canvas rasterizes SVGs at capture scale,
 * which blurs diagrams and is unreliable for <foreignObject>. Pre-rendering each
 * diagram to a crisp PNG (at `scale`x) and embedding that instead sidesteps both
 * problems. Returns null on any failure so callers can fall back to the SVG.
 */
export const rasterizeSvgToPng = async (
  svgMarkup: string,
  scale = 3,
): Promise<RasterResult | null> => {
  if (typeof document === "undefined" || !svgMarkup) return null;

  const { width, height, markup } = prepareSvg(svgMarkup);
  if (!width || !height) return null;

  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  const image = await loadImage(dataUrl);
  if (!image) return null;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Flatten onto white — diagrams are exported onto white PDF pages.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  try {
    return { url: canvas.toDataURL("image/png"), width, height };
  } catch {
    // Tainted canvas (shouldn't happen for inline SVG, but stay defensive).
    return null;
  }
};
