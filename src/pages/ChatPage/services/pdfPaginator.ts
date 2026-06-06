import type { jsPDF } from "jspdf";

export interface PortraitGeom {
  marginPt: number;
  contentWidthPt: number;
  /** canvas pixels per PDF point (canvas.width / contentWidthPt). */
  pxPerPt: number;
  /** target page-height in canvas pixels. */
  sliceHeightPx: number;
}

export interface WideDiagram {
  /** top of the diagram in canvas pixels. */
  topPx: number;
  /** bottom of the diagram in canvas pixels. */
  bottomPx: number;
  /** PNG data URL of the diagram (already high-DPI). */
  src: string;
  /** intrinsic aspect ratio (width / height). */
  ratio: number;
}

const LANDSCAPE_ASPECT_THRESHOLD = 1.4;

/**
 * Find Mermaid diagrams in the export container that deserve their own landscape
 * page: wide (aspect > 1.4) AND wider than the portrait text column (so they'd
 * otherwise be shrunk). Each result carries its canvas-pixel y-range (so the
 * portrait pager can skip it) and its high-DPI PNG (drawn full-bleed landscape).
 */
export function collectWideDiagrams(
  container: HTMLElement,
  canvas: Pick<HTMLCanvasElement, "height">,
): WideDiagram[] {
  const containerRect = container.getBoundingClientRect();
  if (!containerRect.height) return [];

  // CSS px (container layout) → canvas px (post-html2canvas scale).
  const scaleY = canvas.height / containerRect.height;
  // container is border-box width:794 + 24px padding each side → 746px column.
  const portraitContentPx = container.clientWidth - 48;

  const diagrams: WideDiagram[] = [];
  const imgs = container.querySelectorAll<HTMLImageElement>("[data-mermaid-loading] img");
  imgs.forEach((img) => {
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!nw || !nh) return;

    const ratio = nw / nh;
    const intrinsicWidth = parseFloat(img.style.width) || nw;
    if (ratio <= LANDSCAPE_ASPECT_THRESHOLD || intrinsicWidth <= portraitContentPx) return;

    const rect = img.getBoundingClientRect();
    const topPx = Math.max(0, Math.floor((rect.top - containerRect.top) * scaleY));
    const bottomPx = Math.min(canvas.height, Math.ceil((rect.bottom - containerRect.top) * scaleY));
    if (bottomPx > topPx) diagrams.push({ topPx, bottomPx, src: img.src, ratio });
  });

  diagrams.sort((a, b) => a.topPx - b.topPx);
  return diagrams;
}

/**
 * Slice a vertical [startY, endY) band of the rendered canvas across as many
 * portrait pages as needed, breaking at whitespace rows near each page boundary.
 */
export function addPortraitRange(
  doc: jsPDF,
  canvas: HTMLCanvasElement,
  startY: number,
  endY: number,
  addPage: () => void,
  geom: PortraitGeom,
): void {
  if (endY - startY < 1) return;

  let offsetY = startY;
  while (offsetY < endY) {
    const remaining = endY - offsetY;
    let sliceHeight: number;
    if (remaining <= geom.sliceHeightPx) {
      sliceHeight = remaining;
    } else {
      const computed = computeSmartSliceHeight(canvas, offsetY, geom.sliceHeightPx);
      sliceHeight = Math.max(1, Math.min(computed, remaining));
    }

    const sliceCanvas = document.createElement("canvas");
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = sliceHeight;

    const ctx = sliceCanvas.getContext("2d");
    if (!ctx) throw new Error("PDF render failed (no canvas context)");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
    ctx.drawImage(canvas, 0, offsetY, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);

    const imgData = sliceCanvas.toDataURL("image/jpeg", 0.92);
    addPage();
    doc.addImage(
      imgData,
      "JPEG",
      geom.marginPt,
      geom.marginPt,
      geom.contentWidthPt,
      sliceHeight / geom.pxPerPt,
    );

    offsetY += sliceHeight;
  }
}

/** Draw a wide diagram's PNG centered and fit-to-page on a fresh landscape page. */
export function addLandscapeDiagram(
  doc: jsPDF,
  diagram: Pick<WideDiagram, "src" | "ratio">,
  marginPt: number,
  addPage: () => void,
): void {
  addPage();
  // pageSize reflects the just-added landscape page.
  const availWidth = doc.internal.pageSize.getWidth() - marginPt * 2;
  const availHeight = doc.internal.pageSize.getHeight() - marginPt * 2;

  let drawWidth = availWidth;
  let drawHeight = availWidth / diagram.ratio;
  if (drawHeight > availHeight) {
    drawHeight = availHeight;
    drawWidth = availHeight * diagram.ratio;
  }

  const x = marginPt + (availWidth - drawWidth) / 2;
  const y = marginPt + (availHeight - drawHeight) / 2;
  doc.addImage(diagram.src, "PNG", x, y, drawWidth, drawHeight);
}

/**
 * Prefer cutting a page at a near-empty pixel row close to the ideal boundary,
 * so lines of text/diagrams aren't sliced in half across a page break.
 */
export function computeSmartSliceHeight(
  canvas: HTMLCanvasElement,
  offsetY: number,
  targetSliceHeight: number,
): number {
  const remainingHeight = canvas.height - offsetY;
  if (remainingHeight <= targetSliceHeight) {
    return remainingHeight;
  }

  const preferredBreakY = offsetY + targetSliceHeight;
  const minSliceHeight = Math.max(1, Math.floor(targetSliceHeight * 0.72));
  const searchRadius = Math.max(8, Math.floor(targetSliceHeight * 0.12));
  const minBreakY = Math.max(offsetY + minSliceHeight, preferredBreakY - searchRadius);
  const maxBreakY = Math.min(canvas.height - 1, preferredBreakY + searchRadius);

  const breakY = findWhitespaceBreakY(canvas, preferredBreakY, minBreakY, maxBreakY);
  if (breakY === null || breakY <= offsetY) {
    return targetSliceHeight;
  }

  return breakY - offsetY;
}

function findWhitespaceBreakY(
  canvas: HTMLCanvasElement,
  preferredBreakY: number,
  minBreakY: number,
  maxBreakY: number,
): number | null {
  if (minBreakY > maxBreakY || canvas.width <= 0) {
    return null;
  }

  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx || typeof ctx.getImageData !== "function") {
      return null;
    }

    const height = maxBreakY - minBreakY + 1;
    const imageData = ctx.getImageData(0, minBreakY, canvas.width, height).data;
    const rowStride = canvas.width * 4;
    const sampleStep = Math.max(1, Math.floor(canvas.width / 320));
    const whiteThreshold = 245;
    const alphaThreshold = 16;
    const maxInkRatioForWhitespace = 0.03;

    let bestY: number | null = null;
    let bestInkRatio = Number.POSITIVE_INFINITY;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let row = 0; row < height; row += 1) {
      let inkSamples = 0;
      let totalSamples = 0;
      const rowOffset = row * rowStride;

      for (let x = 0; x < canvas.width; x += sampleStep) {
        const index = rowOffset + x * 4;
        const alpha = imageData[index + 3];
        totalSamples += 1;

        if (alpha <= alphaThreshold) {
          continue;
        }

        const r = imageData[index];
        const g = imageData[index + 1];
        const b = imageData[index + 2];
        if (r < whiteThreshold || g < whiteThreshold || b < whiteThreshold) {
          inkSamples += 1;
        }
      }

      if (totalSamples === 0) {
        continue;
      }

      const inkRatio = inkSamples / totalSamples;
      const y = minBreakY + row;
      const distance = Math.abs(y - preferredBreakY);
      const isBetter =
        inkRatio < bestInkRatio || (inkRatio === bestInkRatio && distance < bestDistance);

      if (isBetter) {
        bestInkRatio = inkRatio;
        bestDistance = distance;
        bestY = y;
      }
    }

    if (bestY === null || bestInkRatio > maxInkRatioForWhitespace) {
      return null;
    }

    return bestY;
  } catch {
    // Cross-origin images can taint canvas and block pixel reads.
    return null;
  }
}
